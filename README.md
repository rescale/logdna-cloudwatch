[![CircleCI](https://circleci.com/gh/logdna/logdna-cloudwatch.svg?style=svg)](https://circleci.com/gh/logdna/logdna-cloudwatch)

# LogDNA CloudWatch

The LogDNA AWS CloudWatch integration relies on [AWS Lambda](https://aws.amazon.com/documentation/lambda/) to route your [CloudWatch Logs](http://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html) to LogDNA.

# Rescale Deploy Instructions:

- Make changes on feature branch, merge to master.
- On master branch bump the version in `package.json` to whatever you want.
- Commit the `package.json` change with simple change notes.
- `git push`
- Create a tag and push it: `git tag -a vX.XX.XXX` -> `get push --tags` *Don't forget the `v` prefix in the tag!*
- Execute the `cloudformation-deploy-platform-lambdas` job on the build server to deploy the lambda.

## Configure the LogDNA AWS Lambda function

1. Create a [new Lambda function](https://console.aws.amazon.com/lambda) and select `Author from scratch`
2. For the basic information:
 * Function Name: `logdna-cloudwatch` (you can choose what to name it)
 * Runtime: `Node.js.10.x`
3. Click on the lambda function to edit the details
 * Code entry type: `Upload a .ZIP file `
 * Upload our LogDNA Lambda function [.ZIP File](https://github.com/logdna/logdna-cloudwatch/releases/latest/download/logdna-cloudwatch.zip)
 * Handler: `index.handler`
 * Runtime: `Node.js.10.x`
 * Environment variables: 
    * `LOGDNA_KEY`: YOUR_INGESTION_KEY_HERE *(Required)* 
    * `LOGDNA_HOSTNAME`: Alternative Host Name *(Optional)*  
    * `LOGDNA_TAGS`: Comma-separated Tags *(Optional)*  
    * `LOGDNA_URL`: Custom Ingestion URL *(Optional)*
    * `LOG_RAW_EVENT`: Setting `line` to Raw `event.message` *(Optional, Default: false)*:
        * It can be enabled by setting `LOG_RAW_EVENT` to `YES` or `TRUE`
        * Enabling it moves the following `event`-related `meta` data from the `line` field to the `meta` field:
            * `event.type`: `messageType` of `CloudWatch Log` encoded inside `awslogs.data` in `base64`
            * `event.id`: `id` of each `CloudWatch Log` encoded inside `awslogs.data` in `base64`
            * `log.group`: `LogGroup` where the log is coming from
            * `log.stream`: `LogStream` where the log is coming from
4. For Execution role, assign an [IAM user with basic execution permissions](https://docs.aws.amazon.com/IAM/latest/UserGuide/getting-started_create-admin-group.html) by choosing an existing role and selecting a role that has permissions to upload logs to Amazon CloudWatch logs.

### Configure your AWS CloudWatch Log Group
You have the option of connecting your AWS CloudWatch Log Groups within the Lambda function console or in your CloudWatch console.

### In Lambda Function
1. Add CloudWatch Logs as a Trigger and click it to Configure:
![Configure](https://raw.githubusercontent.com/logdna/artwork/master/logdna-cloudwatch/in_lambda_1.png)
2. Select the CloudWatch Log Group to be sent to LogDNA
3. Choose your own 'Filter name' and make sure 'Enable trigger' is checked.
4. Repeat steps 1-3 to add multiple log groups.

### Alternatively in CloudWatch
1. Select the Log Group to be sent to LogDNA
2. Select the action `Stream to AWS Lambda`
3. Choose Destination: Select the Lambda function created above, i.e.  `logdna-cloudwatch`
4. Configure Log Format and Filters: Choose JSON as a log format
5. Review your settings to `Start Streaming`

### Validate and Test Your Lambda Function
In your Lambda function console, you can configure a test event to see if your Lambda function was set up correctly:

1. Select **Configure test events**:
![Configure](https://raw.githubusercontent.com/logdna/artwork/master/logdna-cloudwatch/validate_1.png)
2. Create a new test event and select the Event template `Hello World` and name your test
3. Replace the sample event data with this:
```
{
    "awslogs": {
        "data": "H4sIAAAAAAAAEzWQQW+DMAyF/wrKmaEkJCbhhjbWCzuBtMNUVSmkNBIQRMKqqep/X6Cb5Ivfs58++45G7ZzqdfMza5Sjt6IpTh9lXReHEsXI3ia9BJnQlHHIhMSEBnmw/WGx6xwcp8Z50M9uN2q/aDUGx2vn/5oYufXs2sXM3tjp3QxeLw7lX6hS47lTz6lTO9i1uynfXkOMe5lsp9Fxzyy/9eS3hTsyXYhOGVCaEsBSgsyEYBkGzrDMAIMQlAq+gQIQSjFhBFgqJOUMAog34WAfoFFOOM8kA0Y5SSH+f0SIb67GRaHq/baosn1UmUlHF7tErxvk5wa56b2Z+iRJ0OP4+AWj9ITzSgEAAA=="
    }
}
```
4. Hit `Test`
5. If execution succeeds, you will see a message similar to this:
![Success](https://raw.githubusercontent.com/logdna/artwork/master/logdna-cloudwatch/validate_5.png)

If you see errors, the most common one is not adding in the ingestion key in the [environment variables](https://docs.logdna.com/docs/cloudwatch#section-configure-the-logdna-aws-lambda-function):
![Error](https://raw.githubusercontent.com/logdna/artwork/master/logdna-cloudwatch/validate_5_error.png)

6. [Log in to your LogDNA console](https://logdna.com/sign-in/) to see the log line from your Lambda function test:
![Dashboard](https://raw.githubusercontent.com/logdna/artwork/master/logdna-cloudwatch/validate_6.png)

### Optional Environment Variables

The following variables can be used to tune this Lambda function for specific use cases. 

* **LOGDNA_MAX_LINE_LENGTH**: The maximum character length for each line, *Optional*
	* **Default**: 32000
* **LOGDNA_MAX_REQUEST_TIMEOUT**: Time limit (in `milliseconds`) for requests made by this HTTP Client, *Optional*
	* **Default**: 30000
* **LOGDNA_FREE_SOCKET_TIMEOUT**: How long (in `milliseconds`) to wait for inactivity before timing out on the free socket, *Optional*
	* **Default**: 300000
	* **Source**: [agentkeepalive#agentoptions](https://github.com/node-modules/agentkeepalive/blob/master/README.md#new-agentoptions)
* **LOGDNA_MAX_REQUEST_RETRIES**: The maximum number of retries for sending a line when there are network failures, *Optional*
	* **Default**: 5
* **LOGDNA_REQUEST_RETRY_INTERVAL**: How frequently (in `milliseconds`) to retry for sending a line when there are network failures, *Optional*
	* **Default**: 100

## Contributing

Contributions are always welcome. See the [contributing guide](/CONTRIBUTING.md) to learn how you can help. Build instructions for the agent are also in the guide.
