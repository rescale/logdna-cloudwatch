// External Libraries
const agent = require('agentkeepalive');
const asyncRetry = require('async').retry;
const request = require('request');
const ssmParameterResolver = require('aws-ssm-parameter-resolve');
const zlib = require('zlib');
const process = require('process');

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
    console.debug('Parsed event: ', parsedEevent);
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
const sendLine = (payload, config, callback) => {
    // Check for Ingestion Key
    if (!config.key) return callback('Missing LogDNA Ingestion Key');

    // Set Hostname
    const hostname = config.hostname || JSON.parse(payload[0].line).log.group;

    console.debug('Pushing logs to: ', LOGDNA_URL);
    // Prepare HTTP Request Options
    const options = {
        url: LOGDNA_URL
        , qs: config.tags ? {
            tags: config.tags
            , hostname: hostname
        } : { hostname: hostname }
        , method: 'POST'
        , body: JSON.stringify({
            e: 'ls'
            , ls: payload
        })
        , auth: { username: config.key }
        , headers: {
            'Content-Type': 'application/json; charset=UTF-8'
            , 'user-agent': config.UserAgent
        }
        , timeout: MAX_REQUEST_TIMEOUT_MS
        , withCredentials: false
        , agent: new agent.HttpsAgent({
            freeSocketTimeout: FREE_SOCKET_TIMEOUT_MS
        })
    };

    // Flush the Log
    asyncRetry({
        times: MAX_REQUEST_RETRIES
        , interval: (retryCount) => {
            return REQUEST_RETRY_INTERVAL_MS * Math.pow(2, retryCount);
        }, errorFilter: (errCode) => {
            return DEFAULT_HTTP_ERRORS.includes(errCode) || errCode === 'INTERNAL_SERVER_ERROR';
        }
    }, (reqCallback) => {
        console.debug('Executing the request: ', options);
        return request(options, (error, response, body) => {
            console.debug('Request callback fired with error: ', error);
            console.debug('Request callback fired with resp: ', response);
            console.debug('Request callback fired with body: ', body);

            if (error) {
                console.debug('Failed to post the logs: ', error);
                return reqCallback(error.code);
            }
            if (response.statusCode >= INTERNAL_SERVER_ERROR) {
                console.debug('Server returned an internal server error: ', body);
                return reqCallback('INTERNAL_SERVER_ERROR');
            }
            console.debug('Non failure response: ', body);
            return reqCallback(null, body);
        });
    }, (error, result) => {
        if (error) {
            console.debug('Caught an error waiting for the results of the post: ', error);
            return callback(error);
        }
        console.debug('Non error Result: ', result);
        return callback(null, result);
    });
};

// Main Handler
const handler = async(event, context, callback) => {
    const config = await getConfig();
    return await sendLine(prepareLogs(parseEvent(event), config.log_raw_event), config, callback);
};

module.exports = {
    getConfig
    , handler
    , parseEvent
    , prepareLogs
    , sendLine
};
