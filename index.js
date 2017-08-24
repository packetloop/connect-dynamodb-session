'use strict';


const connectDynamodbSession = require('./lib').default;


connectDynamodbSession.default = connectDynamodbSession;
connectDynamodbSession.connectDynamodbSession = connectDynamodbSession;
module.exports = connectDynamodbSession;
