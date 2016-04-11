'use strict';

import {withFakeTimers} from './helpers';
import sinon from 'sinon';
require('sinon-stub-promise')(sinon);

import createStore from '../src/index';

const DynamoStore = createStore({Store: null});

const mockClient = overrides => Object.assign({
  init: sinon.stub().returnsPromise().resolves(),
  deleteExpired: sinon.stub().returnsPromise().resolves({scanned: 0, deleted: 0})
}, overrides);


withFakeTimers('Should only be able to get valid session with the correct id', t => {
  const ids = {
    valid: 'valid',
    expired: 'expired',
    invalid: 'invalid',
    error: 'error'
  };
  const content = {foo: 'bar'};
  const get = sinon.stub();
  get.withArgs(ids.valid).returnsPromise().resolves({expires: Date.now() + 500, content});
  get.withArgs(ids.expired).returnsPromise().resolves({expires: Date.now() - 500, content});
  get.withArgs(ids.invalid).returnsPromise().resolves();
  get.returnsPromise().rejects('some error');

  const store = new DynamoStore({client: mockClient({get}), tableName: 'foo'});

  store.get(ids.valid, (err, session) => {
    t.comment('get session with correct id');
    t.false(err, 'error should be null');
    t.deepEqual(session, content, 'session should be as expected');
  });

  store.get(ids.expired, (err, session) => {
    t.comment('get session with expired id');
    t.false(err, 'error should be null');
    t.false(session, 'session should be null');
  });

  store.get(ids.invalid, (err, session) => {
    t.comment('get session with invalid id');
    t.false(err, 'error should be null');
    t.false(session, 'session should be null');
  });

  store.get(ids.error, (err, session) => {
    t.comment('store.get returns error');
    t.equal(err, 'some error', 'error should be as expected');
    t.false(session, 'session should be null');
    t.end();
  });
});


withFakeTimers('Set should update lastModified', (t, clock) => {
  const now = 123;
  clock.tick(now);
  const id = 'abc';
  const session = {foo: 'bar', cookie: {expires: 321}, lastModified: 3};
  const content = Object.assign({}, session, {lastModified: now});
  const put = sinon.stub();
  put.withArgs(id, 321, content).returnsPromise().resolves();
  put.returnsPromise().rejects('some error');

  const store = new DynamoStore({client: mockClient({put}), tableName: 'foo'});

  store.set(id, session, err => {
    t.false(err, 'error should be null');
  });

  store.set('error', session, err => {
    t.equal(err, 'some error', 'error should be as expected');
    t.end();
  });
});

withFakeTimers('Set should not update lastModified if touchAfter is disabled', t => {
  const id = 'abc';
  const session = {foo: 'bar', cookie: {expires: 321}};
  const put = sinon.stub();
  put.withArgs(id, 321, session).returnsPromise().resolves();
  put.returnsPromise().rejects('some error');

  const store = new DynamoStore({client: mockClient({put}), tableName: 'foo', touchAfter: 0});

  store.set(id, session, err => {
    t.false(err, 'error should be null');
    t.true(put.called, 'put should be called');
    t.end();
  });
});

withFakeTimers('Should only touch if not modified recently', (t, clock) => {
  const now = 123456789;
  clock.tick(now);
  const id = 'abc';
  const recentSession = {foo: 'bar', cookie: {expires: 321}, lastModified: now - 100};
  const oldSession = {foo: 'bar', cookie: {expires: 321}, lastModified: now - 100000};

  const setExpires = sinon.stub();
  setExpires.withArgs(id, 321).returnsPromise().resolves();
  setExpires.returnsPromise().rejects('some error');

  const store = new DynamoStore({
    client: mockClient({setExpires}),
    tableName: 'foo',
    touchAfter: 300
  });

  store.touch(id, recentSession, err => {
    t.comment('touch should do nothing for a recently modified session');
    t.false(err, 'error should be null');
    t.equal(setExpires.callCount, 0, 'set expires should not have been called');
  });

  store.touch(id, oldSession, err => {
    t.comment('touch should update expires for older sessions');
    t.false(err, 'error should be null');
    t.equal(setExpires.callCount, 1, 'set expires should have been called');
  });

  store.touch('error', oldSession, err => {
    t.comment('errors should be passed to callback');
    t.equal(err, 'some error', 'error should be as expected');
    t.equal(setExpires.callCount, 2, 'set expires should have been called twice');
  });

  const alwaysTouch = new DynamoStore({
    client: mockClient({setExpires}),
    tableName: 'foo',
    touchAfter: 0
  });

  alwaysTouch.touch(id, recentSession, err => {
    t.comment('touch should update expires for recently modified session');
    t.false(err, 'error should be null');
    t.equal(setExpires.callCount, 3, 'set expires should have been called thrice');
  });

  alwaysTouch.touch(id, oldSession, err => {
    t.comment('touch should update expires for older sessions');
    t.false(err, 'error should be null');
    t.equal(setExpires.callCount, 4, 'set expires should have been called four times');
    t.end();
  });
});

withFakeTimers('Should destroy sessions', t => {
  const id = 'abc';
  const stub = sinon.stub();
  stub.withArgs(id).returnsPromise().resolves();
  stub.returnsPromise().rejects('some error');
  const store = new DynamoStore({
    client: mockClient({delete: stub}),
    tableName: 'foo'
  });
  store.destroy(id, err => {
    t.comment('should destroy');
    t.false(err, 'error should be null');
  });
  store.destroy('foo', err => {
    t.comment('should pass error to callback');
    t.equal(err, 'some error', 'error should be as expected');
    t.end();
  });
});

withFakeTimers('Should work out expires', (t, clock) => {
  clock.tick(500);
  const store = new DynamoStore({client: mockClient(), tableName: 'foo', ttl: 50});
  t.equal(store.getExpires({cookie: {expires: 123}}), 123, 'should use expires number');
  t.equal(store.getExpires({cookie: {expires: '01/01/1970 00:00:05Z'}}), 5000,
    'should use expires string');
  t.equal(store.getExpires({}), 500 + 50, 'should fall back to now + ttl');
  t.end();
});


withFakeTimers('Should cleanup', (t, clock) => {
  const deleteExpired = sinon.stub().returnsPromise().resolves({scanned: 200, deleted: 50});
  const logger = sinon.stub();

  (() => new DynamoStore({
    client: mockClient({deleteExpired}),
    tableName: 'foo',
    cleanupInterval: 50,
    err: logger
  }))();

  t.equal(deleteExpired.callCount, 0, 'should not have called deleteExpired');

  clock.tick(55);
  t.equal(deleteExpired.callCount, 1, 'should have called deleteExpired');

  clock.tick(55);
  t.equal(deleteExpired.callCount, 2, 'should have called deleteExpired');

  clock.tick(55);
  t.equal(deleteExpired.callCount, 3, 'should have called deleteExpired');
  t.equal(logger.callCount, 0, 'should not call error log');

  t.end();
});


withFakeTimers('Should not cleanup if no cleanupInterval set', (t, clock) => {
  const deleteExpired = sinon.stub();

  (() => new DynamoStore({
    client: mockClient({deleteExpired}),
    tableName: 'foo',
    cleanupInterval: 0
  }))();

  clock.tick(55);
  t.equal(deleteExpired.callCount, 0, 'should not have called deleteExpired');

  clock.tick(55);
  t.equal(deleteExpired.callCount, 0, 'should not have called deleteExpired');

  t.end();
});


withFakeTimers('Should still try to cleanup even if errors', (t, clock) => {
  const deleteExpired = sinon.stub().returnsPromise().rejects();
  const logger = sinon.stub();

  (() => new DynamoStore({
    client: mockClient({deleteExpired}),
    tableName: 'foo',
    cleanupInterval: 50,
    err: logger
  }))();

  t.equal(deleteExpired.callCount, 0, 'should not have called deleteExpired');

  clock.tick(55);
  t.equal(deleteExpired.callCount, 1, 'should have called deleteExpired');
  t.equal(logger.callCount, 1, 'should call error log');

  deleteExpired.rejects(); // reset the stub
  clock.tick(55);
  t.equal(deleteExpired.callCount, 2, 'should have called deleteExpired');
  t.equal(logger.callCount, 2, 'should call error log');

  deleteExpired.rejects(); // reset the stub
  clock.tick(55);
  t.equal(deleteExpired.callCount, 3, 'should have called deleteExpired');
  t.equal(logger.callCount, 3, 'should call error log');

  t.end();
});

