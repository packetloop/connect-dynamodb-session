import AWS from 'aws-sdk';

export default ({awsClient: aws, region, endpoint, tableName: TableName,
  consistentRead: ConsistentRead = true,
  readCapacity: ReadCapacityUnits = 5,
  writeCapacity: WriteCapacityUnits = 5}) => {
  const awsClient = aws || new AWS.DynamoDB({region, endpoint});

  const deleteItem = id => awsClient.deleteItem({TableName, Key: {id: {S: id}}}).promise();

  return {
    init: (autoCreate = false) => {
      const describe = awsClient.describeTable({TableName}).promise();
      if (autoCreate) {
        return describe.catch(() =>
          awsClient.createTable({
            TableName,
            AttributeDefinitions: [{AttributeName: 'id', AttributeType: 'S'}],
            KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}],
            ProvisionedThroughput: {ReadCapacityUnits, WriteCapacityUnits}
          }).promise()
        );
      }
      return describe;
    },

    get: id => awsClient.getItem({TableName, ConsistentRead, Key: {id: {S: id}}}).promise()
      .then(data => {
        if (data.Item && data.Item.content && data.Item.expires) {
          return {
            content: JSON.parse(data.Item.content.S.toString()),
            expires: Number(data.Item.expires.N)
          };
        }
        return null;
      }),

    put: (id, expires, content) =>
      awsClient.putItem({
        TableName,
        Item: {
          id: {S: id},
          expires: {N: expires.toString()},
          content: {S: JSON.stringify(content)}
        }
      }).promise(),

    setExpires: (id, expires) =>
      awsClient.updateItem({
        TableName,
        Key: {id: {S: id}},
        UpdateExpression: 'SET expires = :value',
        ExpressionAttributeValues: {':value': {N: expires.toString()}}
      }).promise(),

    delete: deleteItem,

    deleteExpired: when => {
      const scan = startKey =>
        awsClient.scan({
          TableName,
          FilterExpression: 'expires < :when',
          ExpressionAttributeValues: {':when': {N: when.toString()}},
          ProjectionExpression: 'id',
          ExclusiveStartKey: startKey
        }).promise();

      const deletePage = ({scanned, deleted}, startKey = null) =>
        // perform the scan to find expired sessions
        scan(startKey)
          .then(data => Promise.all(data.Items.map(i => i.id.S), deleteItem)
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
