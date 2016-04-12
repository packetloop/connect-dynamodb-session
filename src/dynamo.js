'use strict';

import AWS from 'aws-sdk';
import Promise from 'bluebird';

export default ({awsClient: aws, region, endPoint, tableName}) => {
  const awsClient = aws || new AWS.DynamoDB({region, endpoint: endPoint});

  const deleteItem = id => Promise.fromCallback(cb =>
    awsClient.deleteItem({TableName: tableName, Key: {id: {S: id}}}, cb)
  );

  return {
    init: () => Promise.fromCallback(cb =>
      awsClient.describeTable({TableName: tableName}, cb)
    ),

    get: id => Promise.fromCallback(cb =>
        awsClient.getItem({TableName: tableName, ConsistentRead: true, Key: {id: {S: id}}}, cb)
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
        TableName: tableName, Item: {
          id: {S: id},
          expires: {N: expires.toString()},
          content: {S: JSON.stringify(content)}
        }
      }, cb)
    ),

    setExpires: (id, expires) => Promise.fromCallback(cb =>
      awsClient.updateItem({
        TableName: tableName,
        Key: {id: {S: id}},
        UpdateExpression: 'SET expires = :value',
        ExpressionAttributeValues: {':value': {N: expires.toString()}}
      }, cb)
    ),

    delete: deleteItem,

    deleteExpired: when => {
      const scan = startKey => Promise.fromCallback(cb =>
        awsClient.scan({
          TableName: tableName,
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
