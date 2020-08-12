// External Libraries
const agent = require('agentkeepalive');
const axios = require('axios');
const asyncRetry = require('async').retry;
const ssmParameterResolver = require('aws-ssm-parameter-resolve');
const zlib = require('zlib');
const process = require('process');
const { resolve } = require('path');

// Constants
const MAX_REQUEST_TIMEOUT_MS = parseInt(process.env.LOGDNA_MAX_REQUEST_TIMEOUT) || 30000;
const FREE_SOCKET_TIMEOUT_MS = parseInt(process.env.LOGDNA_FREE_SOCKET_TIMEOUT) || 300000;
const LOGDNA_URL = process.env.LOGDNA_URL || 'https://logs.logdna.com/logs/ingest';
const MAX_REQUEST_RETRIES = parseInt(process.env.LOGDNA_MAX_REQUEST_RETRIES) || 5;
const REQUEST_RETRY_INTERVAL_MS = parseInt(process.env.LOGDNA_REQUEST_RETRY_INTERVAL) || 100;
const INTERNAL_SERVER_ERROR = 500;
const DEFAULT_HTTP_ERRORS = [
    'ECONNRESET'
    , 'EHOSTUNREACH'
    , 'ETIMEDOUT'
    , 'ESOCKETTIMEDOUT'
    , 'ECONNREFUSED'
    , 'ENOTFOUND'
];

// Pulls the LogDNA API key from SSM
const getApiKeyFromSSM = async(ssm_secret_path, param_name) => {
    console.info('Attempting to pull the log dna api key from ssm via the path: ', ssm_secret_path);

    if (!ssm_secret_path || ssm_secret_path === '') {
        console.info('No ssm path was supplied.');

        return undefined;
    }

    try {
        var parameters = await ssmParameterResolver.resolve(ssm_secret_path);

        return parameters.get(param_name);
    } catch (error) {
        console.error('Failed to pull the LogDNA API Key from SSM: ', error);
    }

    return undefined;
};

// Get Configuration from Environment Variables
const getConfig = async() => {
    const pkg = require('./package.json');
    let config = {
        log_raw_event: false
        , UserAgent: `${pkg.name}/${pkg.version}`
    };

    if (process.env.LOGDNA_KEY) config.key = process.env.LOGDNA_KEY;
    if (process.env.LOGDNA_HOSTNAME) config.hostname = process.env.LOGDNA_HOSTNAME;
    if (process.env.LOGDNA_TAGS && process.env.LOGDNA_TAGS.length > 0) {
        config.tags = process.env.LOGDNA_TAGS.split(',').map(tag => tag.trim()).join(',');
    }

    if (process.env.LOG_RAW_EVENT) {
        config.log_raw_event = process.env.LOG_RAW_EVENT.toLowerCase();
        config.log_raw_event = config.log_raw_event === 'yes' || config.log_raw_event === 'true';
    }

    if ((!config.key || config.key === '') && process.env.SSM_SECRET_LOGNDA_KEY_NAME && process.env.SSM_SECRET_LOGNDA_KEY_NAME !== '') {
        console.info('Looking for api key from ssm');
        try {
            config.key = await getApiKeyFromSSM(process.env.SSM_PARAMS_PATH, process.env.SSM_SECRET_LOGNDA_KEY_NAME);
        } catch (error) {
            console.error('Failed to get the api key from ssm: ', error);
            config.key = undefined;
        }

        if (config.key) {
            console.debug('API Key was successfully set.');
        }
    }

    return config;
};

// Parse the GZipped Log Data
const parseEvent = (event) => {
    const parsedEevent = JSON.parse(zlib.unzipSync(Buffer.from(event.awslogs.data, 'base64')));
    return parsedEevent;
};

// Prepare the Messages and Options
const prepareLogs = (eventData, log_raw_event) => {
    return eventData.logEvents.map((event) => {
        const eventMetadata = {
            event: {
                type: eventData.messageType
                , id: event.id
            }, log: {
                group: eventData.logGroup
                , stream: eventData.logStream
            }
        };

        const eventLog = {
            timestamp: event.timestamp
            , file: eventData.logStream
            , meta: {
                owner: eventData.owner
                , filters: eventData.subscriptionFilters
            }, line: JSON.stringify(Object.assign({}, {
                message: event.message
            }, eventMetadata))
        };

        if (log_raw_event) {
            eventLog.line = event.message;
            eventLog.meta = Object.assign({}, eventLog.meta, eventMetadata);
        }

        return eventLog;
    });
};

// Ship the Logs
const sendLine = async(payload, config) => {
    // Check for Ingestion Key
    if (!config.key) throw (new Error('Missing LogDNA Ingestion Key'));

    // Set Hostname
    const hostname = config.hostname || JSON.parse(payload[0].line).log.group;

    // Prepare HTTP Request Options
    const options = {
        url: LOGDNA_URL
        , params: config.tags ? {
            tags: config.tags
            , hostname: hostname
        } : { hostname: hostname }
        , method: 'POST'
        , data: {
            e: 'ls'
            , ls: payload
        }
        , auth: { username: config.key }
        , headers: {
            'user-agent': config.UserAgent
        }
        , responseType: 'json'
        , timeout: MAX_REQUEST_TIMEOUT_MS
        , withCredentials: false
        , httpsAgent: new agent.HttpsAgent({
            freeSocketTimeout: FREE_SOCKET_TIMEOUT_MS
        })
    };

    // Flush the Log
    console.debug('About to run push');
    var result = await asyncRetry({
        times: MAX_REQUEST_RETRIES
        , interval: (retryCount) => {
            return REQUEST_RETRY_INTERVAL_MS * Math.pow(2, retryCount);
        }, errorFilter: (errCode) => {
            console.debug('error filter with code: ', errCode);
            return DEFAULT_HTTP_ERRORS.includes(errCode) || errCode === 'INTERNAL_SERVER_ERROR';
        }
    }, (asyncRetryCallback) => {
        console.debug('in push method.');
        axios.request(options)
            .then((response) => {
                console.debug('response from push: ', response);
                if (response.status >= INTERNAL_SERVER_ERROR) {
                    console.error('Server returned an internal server error: ', response.data);
                    return asyncRetryCallback(new Error(response.statusCode, 'INTERNAL_SERVER_ERROR'));
                }
                return asyncRetryCallback(undefined, response.data);
            })
            .catch((error) => {
                console.error('Failed to post the logs: ', error);
                return asyncRetryCallback(error);
            });
    });
    console.debug('after push, result: ', result);
    return result;
};

// Main Handler
const handler = async(event, context) => {
    const config = await getConfig();
    return new Promise(async(resolve, reject) => {
        try {
            var result = await sendLine(prepareLogs(parseEvent(event), config.log_raw_event), config);
            console.debug('in promise of handler, result: ', result);
            resolve(result);
        } catch (error) {
            console.debug('caught an error from sendline: ', error);
            reject(error);
        }
    });
};

module.exports = {
    getConfig
    , handler
    , parseEvent
    , prepareLogs
    , sendLine
};
