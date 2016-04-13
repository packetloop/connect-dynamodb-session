'use strict';

import AWS from 'aws-sdk';
import Promise from 'bluebird';

export default ({awsClient: aws, region, endpoint, tableName: TableName,
  consistentRead: ConsistentRead = true,
  readCapacity: ReadCapacityUnits = 5,
  writeCapacity: WriteCapacityUnits = 5}) => {
  const awsClient = aws || new AWS.DynamoDB({region, endpoint});

  const deleteItem = id => Promise.fromCallback(cb =>
    awsClient.deleteItem({TableName, Key: {id: {S: id}}}, cb)
  );

  return {
    init: (autoCreate = false) => {
      const describe = Promise.fromCallback(cb => awsClient.describeTable({TableName}, cb));
      if (autoCreate) {
        return describe.catch(() => Promise.fromCallback(cb =>
          awsClient.createTable({
            TableName,
            AttributeDefinitions: [{AttributeName: 'id', AttributeType: 'S'}],
            KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}],
            ProvisionedThroughput: {ReadCapacityUnits, WriteCapacityUnits}
          }, cb))
        );
      }
      return describe;
    },

    get: id => Promise.fromCallback(cb =>
      awsClient.getItem({TableName, ConsistentRead, Key: {id: {S: id}}}, cb)
    ).then(data => {
      if (data.Item && data.Item.content && data.Item.expires) {
        return {
          content: JSON.parse(data.Item.content.S.toString()),
          expires: Number(data.Item.expires.N)
        };
      }
      return null;
    }),

    put: (id, expires, content) => Promise.fromCallback(cb =>
      awsClient.putItem({
        TableName, Item: {
          id: {S: id},
          expires: {N: expires.toString()},
          content: {S: JSON.stringify(content)}
        }
      }, cb)
    ),

    setExpires: (id, expires) => Promise.fromCallback(cb =>
      awsClient.updateItem({
        TableName,
        Key: {id: {S: id}},
        UpdateExpression: 'SET expires = :value',
        ExpressionAttributeValues: {':value': {N: expires.toString()}}
      }, cb)
    ),

    delete: deleteItem,

    deleteExpired: when => {
      const scan = startKey => Promise.fromCallback(cb =>
        awsClient.scan({
          TableName,
          ScanFilter: {
            expires: {
              AttributeValueList: [{N: when.toString()}],
              ComparisonOperator: 'LT'
            }
          },
          AttributesToGet: ['id'],
          ExclusiveStartKey: startKey
        }, cb)
      );

      const deletePage = ({scanned, deleted}, startKey = null) =>
        // perform the scan to find expired sessions
        scan(startKey)
          // use Promise.each to delete each of them one by one so we don't use all the
          // provisioned capacity
          .then(data => Promise.each(data.Items.map(i => i.id.S), deleteItem)
            // once all the sessions are deleted, work out if there are more results to scan
            .then(ids => {
              const lastKey = data.LastEvaluatedKey;
              const stats = {
                scanned: scanned + data.ScannedCount,
                deleted: deleted + ids.length
              };
              // if no key, then we're done
              if (!lastKey) {
                return stats;
              }
              return deletePage(stats, lastKey);
            })
          );

      return deletePage({scanned: 0, deleted: 0});
    }
  };
};
