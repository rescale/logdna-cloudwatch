// External Libraries
const agent = require('agentkeepalive');
const axios = require('axios');
const asyncRetry = require('async').retry;
const ssmParameterResolver = require('aws-ssm-parameter-resolve');
const process = require('process');
const querystring = require('querystring');
const zlib = require('zlib');

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

    config.hostname_prefix = process.env.HOSTNAME_PREFIX ? process.env.HOSTNAME_PREFIX : '';
    config.hostname_postfix = process.env.HOSTNAME_POSTFIX ? process.env.HOSTNAME_POSTFIX : '';
    if (process.env.LOGDNA_APP_NAME) config.app_name = process.env.LOGDNA_APP_NAME;
    if (process.env.LOGDNA_HOSTNAME_FOR_FARGATE) {
        config.hostname_for_fargate = process.env.LOGDNA_HOSTNAME_FOR_FARGATE.toLowerCase();
        config.hostname_for_fargate = config.hostname_for_fargate === 'yes' || config.hostname_for_fargate === 'true';
    }
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
const prepareLogs = (eventData, config) => {
    console.debug('event: ', eventData);
    const logStreamComponents = eventData.logStream.split('/');
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

        if (config.hostname_for_fargate) {
            eventMetadata.log.fargate_log_prefix = logStreamComponents[0];
            eventMetadata.log.fargate_task_name = logStreamComponents[1];
            eventMetadata.log.fargate_task_id = logStreamComponents[2];
        }

        const eventLog = {
            app: logStreamComponents[0]
            , timestamp: event.timestamp
            , file: eventData.logStream
            , meta: {
                owner: eventData.owner
                , filters: eventData.subscriptionFilters
            }, line: JSON.stringify(Object.assign({}, {
                message: event.message
            }, eventMetadata))
        };

        if (config.log_raw_event) {
            eventLog.line = event.message;
            eventLog.meta = Object.assign({}, eventLog.meta, eventMetadata);
        }

        return eventLog;
    });
};

// Ship the Logs
const sendLine = async(payload, config, eventLogGroup, eventLogStream) => {
    // Check for Ingestion Key
    if (!config.key) throw (new Error('Missing LogDNA Ingestion Key'));

    // Set Hostname
    var hostname = config.hostname_prefix;

    if (config.hostname_for_fargate) {
        hostname += eventLogGroup.replace('/', '-');
    } else if (config.hostname) {
        hostname += config.hostname;
    } else {
        hostname += eventLogGroup;
    }

    hostname += config.hostname_postfix;

    // Prepare HTTP Request Options
    const options = {
        url: LOGDNA_URL
        , params: config.tags ? {
            tags: config.tags
            , hostname: hostname
        } : { hostname: hostname }
        , paramsSerializer: (params) => {
            return querystring.stringify(params);
        }
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

    try {
        var response = await axios(options);
        if (response.status >= INTERNAL_SERVER_ERROR) {
            console.error('Server returned an internal server error: ', response.data);
            throw (new Error(response.statusCode, 'INTERNAL_SERVER_ERROR'));
        }
        return response.data;
    } catch (error) {
        console.error('Failed to post the logs: ', error);
        throw (error);
    }
};

// Main Handler
const handler = async(event, context) => {
    const config = await getConfig();
    return new Promise(async(resolve, reject) => {
        try {
            const parsedEvent = parseEvent(event);
            const result = await sendLine(prepareLogs(parsedEvent, config), config, parsedEvent.logGroup, parsedEvent.logStream);
            resolve(result);
        } catch (error) {
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
