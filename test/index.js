// External Modules
const { test } = require('tap');

// Internal Modules
const index = require('../index');
const pkg = require('../package.json');

// Constants
const missingKey = 'Missing LogDNA Ingestion Key';
const hostname = 'sampleCloudWatchHostname';
const inputTags = ' cloudwatch, logging, test';
const outputTags = 'cloudwatch,logging,test';
const sampleKey = '0123456789';
const rawEvent = {
	'awslogs': {
	    'data': 'H4sIAAAAAAAAEzWQQW+DMAyF/wrKmaEkJCbhhjbWCzuBtMNUVSmkNBIQRMKqqep/X6Cb5Ivfs58++45G7ZzqdfMza5Sjt6IpTh9lXReHEsXI3ia9BJnQlHHIhMSEBnmw/WGx6xwcp8Z50M9uN2q/aDUGx2vn/5oYufXs2sXM3tjp3QxeLw7lX6hS47lTz6lTO9i1uynfXkOMe5lsp9Fxzyy/9eS3hTsyXYhOGVCaEsBSgsyEYBkGzrDMAIMQlAq+gQIQSjFhBFgqJOUMAog34WAfoFFOOM8kA0Y5SSH+f0SIb67GRaHq/baosn1UmUlHF7tErxvk5wa56b2Z+iRJ0OP4+AWj9ITzSgEAAA=='
	}
};

const eventData = {
	messageType: 'DATA_MESSAGE'
	, owner: '123456789012'
	, logGroup: 'sampleGroup'
	, logStream: 'testStream'
	, subscriptionFilters: [ 'LambdaStream_cloudwatchlogs-node' ]
	, logEvents: [{
		id: '34622316099697884706540976068822859012661220141643892546'
		, timestamp: 1557946425136
		, message: 'This is Sample Log Line for CloudWatch Logging...'
	}]
};

const eventDataRds = {
	messageType: 'DATA_MESSAGE'
	, owner: '123456789012'
    , logGroup: '/aws/rds/instance/instanceid-123/postgresql'
	, logStream: 'instanceid-123.0'
	, subscriptionFilters: [ 'LambdaStream_cloudwatchlogs-node' ]
	, logEvents: [{
		id: '34622316099697884706540976068822859012661220141643892546'
		, timestamp: 1557946425136
		, message: 'This is Sample Log Line for RDS CloudWatch Logging...'
	}]
};

const eventMetaData = {
	event: {
		type: eventData.messageType
		, id: eventData.logEvents[0].id
	}, log: {
		group: eventData.logGroup
		, stream: eventData.logStream
	}
};

const eventMetaDataRds = {
	event: {
		type: eventDataRds.messageType
		, id: eventDataRds.logEvents[0].id
	}, log: {
		group: eventDataRds.logGroup
		, stream: eventDataRds.logStream
	}
};

// Test parseEvent
test('test parseEvent with the sample test data described in README', (t) => {
	t.deepEqual(index.parseEvent(rawEvent), eventData);
	t.end();
});

// Test getConfig
test('test getConfig', async(t) => {
	// Test getConfig without any environment variable set
	let config = await index.getConfig();
	t.equal(config.key, undefined);
	t.equal(config.log_raw_event, false);
	t.equal(config.UserAgent, `${pkg.name}/${pkg.version}`);
	t.equal(config.hostname, undefined);
	t.equal(config.tags, undefined);

	// Set Hostname, Key and Tags
	process.env.LOGDNA_HOSTNAME = hostname;
	process.env.LOGDNA_TAGS = inputTags;
	process.env.LOGDNA_KEY = sampleKey;
	config = await index.getConfig();
	t.equal(config.key, sampleKey);
	t.equal(config.log_raw_event, false);
	t.equal(config.UserAgent, `${pkg.name}/${pkg.version}`);
	t.equal(config.hostname, hostname);
	t.equal(config.tags, outputTags);

	// Set LOG_RAW_EVENT to True
	process.env.LOG_RAW_EVENT = 'True';
	config = await index.getConfig();
	t.equal(config.key, sampleKey);
	t.equal(config.log_raw_event, true);
	t.equal(config.UserAgent, `${pkg.name}/${pkg.version}`);
	t.equal(config.hostname, hostname);
	t.equal(config.tags, outputTags);

	// Unset some environment variables
	process.env.LOG_RAW_EVENT = '';
	process.env.LOGDNA_TAGS = '';
	config = await index.getConfig();
	t.equal(config.key, sampleKey);
	t.equal(config.log_raw_event, false);
	t.equal(config.UserAgent, `${pkg.name}/${pkg.version}`);
	t.equal(config.hostname, hostname);
	t.equal(config.tags, undefined);

	// Set LOG_RAW_EVENT to Yes
	process.env.LOG_RAW_EVENT = 'yEs';
	config = await index.getConfig();
	t.equal(config.key, sampleKey);
	t.equal(config.log_raw_event, true);
	t.equal(config.UserAgent, `${pkg.name}/${pkg.version}`);
	t.equal(config.hostname, hostname);
	t.equal(config.tags, undefined);

	// Finish the test suite
	t.end();
});

// Test prepareLogs
test('test prepareLogs', (t) => {
	// Without log_raw_event set to true
	const config1 = {
		log_raw_event: false
	};
	let eventLog = index.prepareLogs(eventData, config1)[0];
	t.assert(eventLog.timestamp < Date.now());
	t.equal(eventLog.file, eventData.logStream);
	t.equal(eventLog.meta.owner, eventData.owner);
	t.deepEqual(eventLog.meta.filters, eventData.subscriptionFilters);
	t.deepEqual(JSON.parse(eventLog.line), Object.assign({
		message: eventData.logEvents[0].message
	}, eventMetaData));

	// With log_raw_event set to true
	const config2 = {
		log_raw_event: true
	};
	eventLog = index.prepareLogs(eventData, config2)[0];
	t.assert(eventLog.timestamp < Date.now());
	t.equal(eventLog.file, eventData.logStream);
	t.equal(eventLog.line, eventData.logEvents[0].message);
	t.deepEqual(eventLog.meta, Object.assign({
		owner: eventData.owner
		, filters: eventData.subscriptionFilters
	}, eventMetaData));

	// Finish the test suite
	t.end();
});

// Test prepareLogs for rds
test('test prepareLogs for rds', (t) => {
	// Without log_raw_event set to true
	const config1 = {
		log_raw_event: false
	};
	let eventLog = index.prepareLogs(eventDataRds, config1)[0];
	t.assert(eventLog.timestamp < Date.now());
	t.equal(eventLog.file, eventDataRds.logStream);
	t.equal(eventLog.meta.owner, eventDataRds.owner);
	t.deepEqual(eventLog.meta.filters, eventDataRds.subscriptionFilters);
	t.deepEqual(JSON.parse(eventLog.line), Object.assign({
		message: eventDataRds.logEvents[0].message
    }, eventMetaDataRds));
    t.equal(eventLog.app, "rds-postgresql-instanceid-123");

	// With log_raw_event set to true
	const config2 = {
		log_raw_event: true
	};
	eventLog = index.prepareLogs(eventDataRds, config2)[0];
	t.assert(eventLog.timestamp < Date.now());
	t.equal(eventLog.file, eventDataRds.logStream);
	t.equal(eventLog.line, eventDataRds.logEvents[0].message);
	t.deepEqual(eventLog.meta, Object.assign({
		owner: eventDataRds.owner
		, filters: eventDataRds.subscriptionFilters
    }, eventMetaDataRds));
    t.equal(eventLog.app, "rds-postgresql-instanceid-123");


	// Finish the test suite
	t.end();
});


// Test sendLine
test('test sendLine', (t) => {
	t.rejects(index.sendLine({ line: eventData.logEvents[0].message }, {}, 'test-log-group', 'test/log/stream'), missingKey);
	t.end();
});

// Test handler
test('test handler', (t) => {
	t.rejects(index.sendLine(rawEvent, {}, 'test-log-group', 'test/log/stream'), missingKey);
	t.end();
});
