'use strict';

import test from 'blue-tape';
import sinon from 'sinon';

import dynamo from '../../src/dynamo';

const tableName = 'foo';

test('Init should succeed when no errors', () => {
  const awsClient = {
    describeTable: sinon.stub()
      .withArgs({TableName: tableName})
      .callsArgWith(1, null)
  };
  return dynamo({awsClient, tableName}).init();
});

test('Init should pass errors on', t => {
  const awsClient = {
    describeTable: sinon.stub()
    .withArgs({TableName: tableName})
    .callsArgWith(1, new TypeError())
  };
  return t.shouldFail(dynamo({awsClient, tableName}).init(), TypeError, 'should return type error');
});

test('Should be able to get a session', t => {
  const id = 'abc';
  const awsClient = {
    getItem: sinon.stub()
      .withArgs({
        TableName: tableName,
        ConsistentRead: true,
        Key: {id: {S: id}}
      })
      .callsArgWith(1, null, {
        Item: {
          content: {S: '{"foo": 42}'},
          expires: {N: '123'}
        }
      })
  };
  return dynamo({awsClient, tableName})
    .get(id)
    .then(({expires, content}) => {
      t.equal(expires, 123, 'expires should be 123');
      t.deepEqual(content, {foo: 42}, 'content should be as expected');
    });
});

test('Should be able to not find a session', t => {
  const awsClient = {
    getItem: sinon.stub().callsArgWith(1, null, {Item: {}})
  };
  return dynamo({awsClient, tableName})
    .get('abc')
    .then(row => t.false(row, 'should resolve with null'));
});

test('Should reject for invalid json content', t => {
  const awsClient = {
    getItem: sinon.stub()
      .callsArgWith(1, null, {
        Item: {
          content: {S: '[}not json'},
          expires: {N: '123'}
        }
      })
  };
  return t.shouldFail(dynamo({awsClient, tableName}).get('abc'), SyntaxError);
});

test('Should be able to put a session', () => {
  const id = 'abc';
  const expires = '123';
  const content = {foo: 'bar'};
  const awsClient = {
    putItem: sinon.stub()
      .withArgs({
        TableName: tableName,
        Item: {
          id: {S: id},
          expires: {N: expires},
          content: {S: JSON.stringify(content)}
        }
      })
      .callsArgWith(1, null)
  };
  return dynamo({awsClient, tableName}).put(id, expires, content);
});

test('Should pass put errors on', t => {
  const awsClient = {
    putItem: sinon.stub().callsArgWith(1, new TypeError())
  };
  return t.shouldFail(dynamo({awsClient, tableName}).put('abc', '123', '42'), TypeError);
});

test('Should be able to delete a session', () => {
  const id = 'abc';
  const awsClient = {
    deleteItem: sinon.stub()
      .withArgs({
        TableName: tableName,
        Key: {id: {S: id}}
      })
      .callsArgWith(1, null)
  };
  return dynamo({awsClient, tableName}).delete(id);
});

test('Should pass delete errors on', t => {
  const awsClient = {
    deleteItem: sinon.stub().callsArgWith(1, new TypeError())
  };
  return t.shouldFail(dynamo({awsClient, tableName}).delete('abc'), TypeError);
});

const scanQuery = (when, startKey = null) => ({
  TableName: tableName,
  ScanFilter: {
    expires: {
      AttributeValueList: [{N: when.toString()}],
      ComparisonOperator: 'LT'
    }
  },
  AttributesToGet: ['id'],
  ExclusiveStartKey: startKey
});

test('Should handle when scan returns no results', t => {
  const awsClient = {
    scan: sinon.stub()
      .withArgs(scanQuery(200))
      .callsArgWith(1, null, {Items: [], ScannedCount: 34})
  };
  return dynamo({awsClient, tableName})
    .deleteExpired(200)
    .then(({scanned, deleted}) => {
      t.equal(scanned, 34, 'scanned should be 34');
      t.equal(deleted, 0, 'deleted should be 0');
    });
});

test('Should pass errors on when deleteing expired', t => {
  const awsClient = {
    scan: sinon.stub()
      .withArgs(scanQuery(200))
      .callsArgWith(1, new TypeError())
  };
  return t.shouldFail(dynamo({awsClient, tableName}).deleteExpired(200), TypeError);
});

test('Should be able to delete one page of results', t => {
  const awsClient = {
    deleteItem: sinon.stub().callsArgWith(1, null),
    scan: sinon.stub()
      .withArgs(scanQuery(200))
      .callsArgWith(1, null, {
        Items: [
          {id: {S: 'john'}},
          {id: {S: 'paul'}}
        ],
        ScannedCount: 34
      })
  };

  return dynamo({awsClient, tableName})
    .deleteExpired(200)
    .then(({scanned, deleted}) => {
      t.equal(scanned, 34, 'scanned should be 34');
      t.equal(deleted, 2, 'deleted should be 2');
    });
});

test('Should be able to delete multiple pages of results', t => {
  const scan = sinon.stub();

  // first call returns 2 items and a last evaluated key of 'brian'
  scan.withArgs(scanQuery(200))
    .callsArgWith(1, null, {
      Items: [
        {id: {S: 'john'}},
        {id: {S: 'paul'}}
      ], ScannedCount: 34, LastEvaluatedKey: 'brian'
    });

  // second call returns 0 items and a last evaluated key of 'yoko'
  scan.withArgs(scanQuery(200, 'brian'))
    .callsArgWith(1, null, {
      Items: [],
      ScannedCount: 54, LastEvaluatedKey: 'yoko'
    });

  // last call returns 2 items and no last evaluated key
  scan.withArgs(scanQuery(200, 'yoko'))
    .callsArgWith(1, null, {
      Items: [
        {id: {S: 'george'}},
        {id: {S: 'ringo'}}
      ], ScannedCount: 18
    });

  const awsClient = {
    deleteItem: sinon.stub().callsArgWith(1, null),
    scan
  };

  return dynamo({awsClient, tableName})
    .deleteExpired(200)
    .then(({scanned, deleted}) => {
      t.equal(scanned, 34 + 54 + 18, 'scanned should be the total');
      t.equal(deleted, 4, 'deleted should be 4');
    });
});
