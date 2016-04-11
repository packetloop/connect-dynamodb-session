'use strict';

// TODO refactor to use sinon and spit out dynamo client tests

import test from 'blue-tape';
import {withFakeTimers} from './helpers';

import createStore from '../src/index';

const DynamoStore = createStore({Store: null});

const testStore = ({options = {}, client: overrides = {}}) => {
  const awsClient = {
    scan: overrides.scan || ((_, callback) => callback(null, {Items: []})),
    describeTable: overrides.describeTable || ((_, callback) => callback(null)),
    getItem: overrides.getItem || ((_, callback) => callback(null, null)),
    putItem: overrides.putItem || ((_, callback) => callback(null)),
    updateItem: overrides.updateItem || ((_, callback) => callback(null)),
    deleteItem: overrides.deleteItem || ((_, callback) => callback(null))
  };
  return new DynamoStore(Object.assign({tableName: 'testTable', awsClient}, options));
};

withFakeTimers('Should use custom or default values', t => {
  const defaults = testStore({});
  t.equal(defaults.ttl, 14 * 24 * 60 * 60 * 1000, 'ttl should be 2 weeks');
  t.equal(defaults.cleanupInterval, 5 * 60 * 1000, 'cleanupInterval should be 5 minutes');
  t.equal(defaults.touchAfter, 10 * 1000, 'touchAfter should be 10 seconds');

  const customs = testStore({options: {ttl: 1, cleanupInterval: 0, touchAfter: 3}});
  t.equal(customs.ttl, 1, 'ttl should be 1');
  t.equal(customs.cleanupInterval, 0, 'cleanupInterval should be 0');
  t.equal(customs.touchAfter, 3, 'touchAfter should be 3');
  t.end();
});

test('Should still succeed if can not connect to dynamodb', t => {
  t.doesNotThrow(() => testStore({
    client: {describeTable: (_, callback) => callback(true)}
  }),
    undefined, 'should not throw error if can not connect to dynamodb');
  t.end();
});

withFakeTimers('Should be able to get a sessionId', t => {
  t.plan(2); // use plan because client.get uses a .then
  const store = testStore({
    client: {
      getItem: (_, callback) => callback(null, {
        Item: {
          expires: {N: `${Date.now() + 5000}`},
          content: {S: '{"key":"value"}'}
        }
      })
    }
  });
  store.get('bar', (err, session) => {
    t.deepEqual(session, {key: 'value'}, 'session should be as expected');
    t.equal(err, null, 'error should be null');
  });
});

withFakeTimers('Should not get an expired session', t => {
  t.plan(2); // use plan because client.get uses a .then
  const store = testStore({
    client: {
      getItem: (_, callback) => callback(null, {
        Item: {
          expires: {N: `${Date.now() - 5000}`},
          content: {S: '{"key":"value"}'}
        }
      })
    }
  });
  store.get('bar', (err, session) => {
    t.equal(session, null, 'session should be null');
    t.equal(err, null, 'error should be null');
  });
});

withFakeTimers('Should not get a session with invalid content', t => {
  const store = testStore({
    client: {
      getItem: (_, callback) => callback(null, {
        Item: {
          expires: {N: `${Date.now() + 5000}`},
          content: {S: '[not 4ny},,, JSON'}
        }
      })
    }
  });
  store.get('bar', (err, session) => {
    t.false(session, 'session should be null');
    t.equal(err.name, 'SyntaxError', 'error should be an error');
    t.end();
  });
});

withFakeTimers('Should fail if no session', t => {
  const store = testStore({});
  store.get('bar', (err, session) => {
    t.false(session, null, 'session should be null');
    t.equal(err.name, 'TypeError', 'error should be an error');
    t.end();
  });
});

withFakeTimers('Should be able to set session', (t, clock) => {
  const now = 345;
  clock.tick(345);
  t.plan(4);
  const content = {
    foo: 'bar',
    arr: [1, 2, 3],
    obj: {a: 42},
    cookie: {expires: 400},
    lastModified: now
  };
  const store = testStore({
    client: {
      putItem: ({Item}, callback) => {
        t.equal(Item.id.S, 'bar', 'id should be bar');
        t.equal(Item.expires.N, '400', 'expires should be 400');
        t.equal(Item.content.S, JSON.stringify(content), 'content should be correct');
        callback(null);
      }
    }
  });
  // change lastModified before we give it to the store
  const session = Object.assign({}, content, {lastModified: 3});
  store.set('bar', session, err => {
    t.equal(err, null, 'error should be null');
  });
});

withFakeTimers('Should set session with defaults', (t, clock) => {
  clock.tick(500);
  t.plan(4);
  const content = {
    foo: 'bar',
    arr: [1, 2, 3],
    obj: {a: 42}
  };
  const store = testStore({
    options: {ttl: 150, touchAfter: 0},
    client: {
      putItem: ({Item}, callback) => {
        t.equal(Item.id.S, 'bar', 'id should be bar');
        t.equal(Item.expires.N, '650', 'expires should be 150 + 500');
        t.equal(Item.content.S, JSON.stringify(content), 'content should be correct');
        callback(null);
      }
    }
  });
  store.set('bar', content, err => {
    t.equal(err, null, 'error should be null');
  });
});

withFakeTimers('Should fail if can not set session', t => {
  t.plan(1);
  const store = testStore({client: {putItem: (_, callback) => callback('error')}});
  store.set('bar', {}, err => {
    t.equal(err.name, 'Error', 'error should be an error');
  });
});

withFakeTimers('Should only update session if not recently modified', t => {
  t.plan(3);
  let shouldUpdate = false;
  const store = testStore({
    options: {touchAfter: 100},
    client: {updateItem: (_, callback) => {
      if (shouldUpdate) {
        t.pass('should call updateItem');
      } else {
        t.end('should not call updateItem');
      }
      callback(null);
    }}
  });

  store.touch('bar', {lastModified: Date.now() - 50}, err => {
    t.equal(err, null, 'error should be null');
  });

  shouldUpdate = true;
  store.touch('bar', {lastModified: Date.now() - 150}, err => {
    t.equal(err, null, 'error should be null');
  });
});

const oldSetTimeout = global.setTimeout;
test('DynamoDB SessionStore cleanup no expired sessions', t => {
  // TODO make this less complicated

  // store a var to point to the fn that the store calls to setTimeout
  // we can't use the sinon mocks because the source code that calls setTimeout is in an
  // async block, so if we do our tests, then advance sinon's timer, the code to call setTimeout
  // hasn't executed yet so the test will think it is done and exit without calling the function
  // sent to setTimeout
  let timeoutFn;
  global.setTimeout = fn => { // eslint-disable-line no-native-reassign
    timeoutFn = fn;
  };

  const expected = [
    'first scan',
    'delete:john',
    'delete:george',
    'second scan',
    'third scan',
    'delete:paul',
    'delete:ringo'
  ];

  let counter = 0;
  let first = true;

  const log = s => {
    t.equal(s, expected[counter], s);
    counter = counter + 1;

    // once we get to the eld of the expected list, reset the counter and trigger the timeout
    if (counter === expected.length && first) {
      t.pass('resetting counter and advancing to trigger timeout');
      first = false;
      counter = 0;
      // after all the results are deleted, the source code calls setTimeout, so wait 1 ms so
      // we have a reference to that function, then call it.
      oldSetTimeout(() => timeoutFn(), 1);
    }
  };

  // we are going to try to run through the expected list twice, plus also assert a pass when we
  // reset the counter
  t.plan(expected.length * 2 + 1);

  testStore({client: {
    scan: ({ExclusiveStartKey: key}, callback) => {
      // the first time we call scan, key will be null, so return john and george and the
      // `from first` key
      if (key === null) {
        log('first scan');
        callback(null, {Items: [
          {id: {S: 'john'}},
          {id: {S: 'george'}}
        ], LastEvaluatedKey: 'from first'});

        // after deleting john and george, scan will be called with `from first` as the start key
        // this time return no items and the `from second` key - this mocks the case where
        // dynamodb scans 1MB of records and doesn't find any that match our filter
      } else if (key === 'from first') {
        log('second scan');
        callback(null, {Items: [], LastEvaluatedKey: 'from second'});

        // we should then call scan again with the `from second` start key, now return paul and
        // ringo, but no LastEvaluatedKey to show there are no more results to scan
      } else if (key === 'from second') {
        log('third scan');
        callback(null, {Items: [
          {id: {S: 'paul'}},
          {id: {S: 'ringo'}}
        ]});
      } else {
        t.fail(`called scan with invalid key ${key}`);
        callback(null);
      }
    },
    deleteItem: ({Key: {id: {S: id}}}, callback) => {
      log(`delete:${id}`);
      callback(null);
    }
  }});
  oldSetTimeout(() => timeoutFn(), 10);
}).on('end', () => {
  global.setTimeout = oldSetTimeout; // eslint-disable-line no-native-reassign
});


withFakeTimers('Dynamo SessionStore cleanup disabled', t => {
  testStore({options: {cleanupInterval: 0}, client: {
    scan: () => t.end('should not call scan'),
    deleteItem: () => t.end('should not call deleteItem')
  }});
  t.pass('should not run cleanup');
  t.end();
});
