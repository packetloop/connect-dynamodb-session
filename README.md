# connect-dynamodb-session

[DynamoDB](https://aws.amazon.com/dynamodb) session store for [Connect](https://github.com/senchalabs/connect) and [Express](http://expressjs.com/)

[![Circle CI](https://circleci.com/gh/andysprout/connect-dynamodb-session.svg?style=svg)](https://circleci.com/gh/andysprout/connect-dynamodb-session)
[![Test Coverage](https://codeclimate.com/github/andysprout/connect-dynamodb-session/badges/coverage.svg)](https://codeclimate.com/github/andysprout/connect-dynamodb-session/coverage)
[![Code Climate](https://codeclimate.com/github/andysprout/connect-dynamodb-session/badges/gpa.svg)](https://codeclimate.com/github/andysprout/connect-dynamodb-session)
[![Dependency Status](https://david-dm.org/andysprout/connect-dynamodb-session.svg)](https://david-dm.org/andysprout/connect-dynamodb-session)
[![devDependency Status](https://david-dm.org/andysprout/connect-dynamodb-session/dev-status.svg)](https://david-dm.org/andysprout/connect-dynamodb-session#info=devDependencies)

## Usage

### Create the table
For example using the aws cli:

```bash
aws \
    --region us-west-2 \
    dynamodb create-table \
    --table-name ${YOUR_TABLE_NAME} \
    --attribute-definitions AttributeName=id,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5
```

Be sure to read the [aws documentation](http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ProvisionedThroughput.html) about `ReadCapacityUnits` and `WriteCapacityUnits` before deploying to production. 

### Express or Connect integration

```js
const session = require('express-session');
const DynamoStore = require('connect-dynamodb-session')(session);

app.use(session({
  secret: 'foo',
  store: new DynamoStore(options)
}));
```


## Options

  - `client` **(optional)** provide your own client that exposes `init`, `get`, `put`, `delete`, `setExpires` & `deleteExpired`, see `src/dynamo.js` for an implementation.
  - `ttl` **(optional, default: 1209600000 (two weeks))** expiration time of session in milliseconds. Fall back to use if the cookie does not have an expires value. Normally you set the expires value for the cookie:
    ```js
app.use(session({
  cookie: {maxAge: 1209600000},
  secret: 'foo',
  store: new DynamoStore(options)
}));
    ```
  - `cleanupInterval` **(optional, default: 300000 (five minutes))** how often to scan the table and remove expired sessions. Set to `0` to never remove expired sessions.
  - `touchAfter` **(optional, default: 10000 (ten seconds))** if the session hasn't changed, then don't persist it to dynamo more than once every 10 seconds. Set to `0` to always update dynamo **WARNING** setting to `0` can seriously impact your `WriteCapacityUnits`. Inspired by [connect-mongo](https://github.com/kcbanner/connect-mongo)
  - `err` (optional, default: `() => {}`) error logging, called with `(message, error)`
  - `log` (optional, default: `() => {}`) debug logging, called with `(message)`

### AWS Options

  - `region` (required (unless `awsClient` set)) aws region to use.
  - `tableName` (required) name of the dynamodb table to use
  - `endPoint` (optional) override the aws endpoint, for example to use a [local dynamodb](http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Tools.DynamoDBLocal.html) for development
  - `awsClient` (optional) override the aws dynamo db client, for testing or to use a pre-configured client.

## Tests

```
  npm run lint
  npm run test
  npm run coverage
```

## Roadmap

* Add an `autoCreate` option to automatically create the dynamodb table if it doesn`t exist.
* Use [local dynamodb](http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Tools.DynamoDBLocal.html) for integration testing.

## License

The MIT License
