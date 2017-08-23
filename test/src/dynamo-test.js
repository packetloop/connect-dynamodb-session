import test from 'blue-tape';
import sinon from 'sinon';
require('sinon-stub-promise')(sinon);

import dynamo from '../../src/dynamo';

const tableName = 'foo';

test('Init should succeed when no errors', () => {
  const promise = sinon.stub().withArgs({TableName: tableName}).returnsPromise().resolves();
  const awsClient = {describeTable: () => ({promise})};

  return dynamo({awsClient, tableName}).init();
});

test('Init should pass errors on', t => {
  const promise = sinon.stub().withArgs({TableName: tableName}).returnsPromise()
    .rejects(new TypeError());
  const awsClient = {describeTable: () => ({promise})};

  return t.shouldFail(dynamo({awsClient, tableName}).init(), TypeError, 'should return type error');
});

test('Should be able to get a session', t => {
  const id = 'abc';
  const promise = sinon.stub()
    .withArgs({
      TableName: tableName,
      ConsistentRead: true,
      Key: {id: {S: id}}
    }).returnsPromise()
    .resolves({
      Item: {
        content: {S: '{"foo": 42}'},
        expires: {N: '123'}
      }
    });
  const awsClient = {getItem: () => ({promise})};

  return dynamo({awsClient, tableName})
    .get(id)
    .then(({expires, content}) => {
      t.equal(expires, 123, 'expires should be 123');
      t.deepEqual(content, {foo: 42}, 'content should be as expected');
    });
});

test('Should be able to not find a session', t => {
  const promise = sinon.stub()
    .withArgs().returnsPromise()
    .resolves({Item: {}});
  const awsClient = {getItem: () => ({promise})};

  return dynamo({awsClient, tableName})
    .get('abc')
    .then(row => t.false(row, 'should resolve with null'));
});

test('Should reject for invalid json content', t => {
  const promise = sinon.stub()
    .withArgs().returnsPromise()
    .resolves({
      Item: {
        content: {S: '[}not json'},
        expires: {N: '123'}
      }
    });
  const awsClient = {getItem: () => ({promise})};

  return t.shouldFail(dynamo({awsClient, tableName}).get('abc'), SyntaxError);
});

test('Should be able to put a session', () => {
  const id = 'abc';
  const expires = '123';
  const content = {foo: 'bar'};
  const promise = sinon.stub()
    .withArgs({
      TableName: tableName,
      Item: {
        id: {S: id},
        expires: {N: expires},
        content: {S: JSON.stringify(content)}
      }
    }).returnsPromise()
    .resolves();
  const awsClient = {putItem: () => ({promise})};

  return dynamo({awsClient, tableName}).put(id, expires, content);
});

test('Should pass put errors on', t => {
  const promise = sinon.stub().withArgs({TableName: tableName}).returnsPromise()
    .rejects(new TypeError());
  const awsClient = {putItem: () => ({promise})};

  return t.shouldFail(dynamo({awsClient, tableName}).put('abc', '123', '42'), TypeError);
});

test('Should be able to delete a session', () => {
  const id = 'abc';
  const promise = sinon.stub()
    .withArgs({
      TableName: tableName,
      Key: {id: {S: id}}
    })
    .returnsPromise()
    .resolves();
  const awsClient = {deleteItem: () => ({promise})};

  return dynamo({awsClient, tableName}).delete(id);
});

test('Should pass delete errors on', t => {
  const promise = sinon.stub().withArgs({TableName: tableName}).returnsPromise()
    .rejects(new TypeError());
  const awsClient = {deleteItem: () => ({promise})};

  return t.shouldFail(dynamo({awsClient, tableName}).delete('abc'), TypeError);
});

const scanQuery = (when, startKey = null) => ({
  TableName: tableName,
  FilterExpression: 'expires < :when',
  ExpressionAttributeValues: {':when': {N: when.toString()}},
  ProjectionExpression: 'id',
  ExclusiveStartKey: startKey
});

test('Should handle when scan returns no results', t => {
  const promise = sinon.stub()
    .withArgs(scanQuery(200))
    .returnsPromise()
    .resolves({Items: [], ScannedCount: 34});
  const awsClient = {scan: () => ({promise})};

  return dynamo({awsClient, tableName})
    .deleteExpired(200)
    .then(({scanned, deleted}) => {
      t.equal(scanned, 34, 'scanned should be 34');
      t.equal(deleted, 0, 'deleted should be 0');
    });
});

test('Should pass errors on when deleteing expired', t => {
  const promise = sinon.stub().withArgs(scanQuery(200)).returnsPromise()
    .rejects(new TypeError());
  const awsClient = {scan: () => ({promise})};

  return t.shouldFail(dynamo({awsClient, tableName}).deleteExpired(200), TypeError);
});

test('Should be able to delete one page of results', t => {
  const promise = sinon.stub()
    .withArgs(scanQuery(200))
    .returnsPromise()
    .resolves({
      Items: [
        {id: {S: 'john'}},
        {id: {S: 'paul'}}
      ],
      ScannedCount: 34
    });
  const awsClient = {scan: () => ({promise})};

  return dynamo({awsClient, tableName})
    .deleteExpired(200)
    .then(({scanned, deleted}) => {
      t.equal(scanned, 34, 'scanned should be 34');
      t.equal(deleted, 2, 'deleted should be 2');
    });
});
