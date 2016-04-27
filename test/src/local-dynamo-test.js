import {sequence} from '../helpers';
import localDynamo from 'local-dynamo';
import AWS from 'aws-sdk';

import createStore from '../../src/index';
const DynamoStore = createStore({Store: null});
const region = 'us-west-2';
const endpoint = 'http://localhost:4567';
const options = {
  tableName: 'foo',
  endpoint,
  region,
  // err: (message, error) => console.log(`ERROR: ${message}`, error),
  // log: (message, d) => console.log(`DEBUG: ${message}`, d),
  autoCreate: true,
  ttl: 300,
  cleanupInterval: 500,
  touchAfter: 100
};
const id = 'abc';
const start = 100;
const sessionNoCookie = {foo: 'bar'};
const sessionWithCookie = {foo: 'moo', cookie: {expires: 500}};

AWS.config.update({accessKeyId: 'akid', secretAccessKey: 'secret'});
const awsClient = new AWS.DynamoDB({region, endpoint});
const getItem = (t, fn) => awsClient.getItem({TableName: 'foo', Key: {id: {S: id}}},
  (err, data) => {
    t.false(err, 'error should be null');
    fn(data.Item);
  });


let localdb;
let store;
sequence('Should be able to get and set a session', [
  (t, next) => {
    t.comment('Launching local dynamodb');
    localdb = localDynamo.launch({dir: null, port: 4567, stdio: 'inherit'});
    next(1000); // wait for the java process to start
  },

  (t, next) => {
    t.comment('Creating dynamo store');
    store = new DynamoStore(options);
    next(500); // wait for the store to connect to the db and create the table using autoCreate
  },

  (t, next) => {
    t.comment('Getting a session that doesn\'t exist');
    store.get(id, (error, session) => {
      t.false(error, 'error should be null');
      t.false(session, 'session should be null');
      next();
    });
  },

  (t, next) => {
    t.comment('Setting a session with no cookie');
    store.set(id, sessionNoCookie, error => {
      t.false(error, 'error should be null');
      next();
    });
  },

  (t, next, clock) => {
    t.comment('Getting the session with no cookie');
    store.get(id, (error, {foo, lastModified}) => {
      t.false(error, 'error should be null');
      t.equal(foo, 'bar', 'session.foo should be as "bar"');
      t.equal(lastModified, clock.now, 'session.lastModified should be now');
      getItem(t, item => {
        t.equal(Number(item.expires.N), clock.now + 300, 'expires should be now + ttl');
        next();
      });
    });
  },

  (t, next, clock) => {
    t.comment('Advance the clock and touch the session');
    clock.tick(50);
    store.touch(id, sessionNoCookie, error => {
      t.false(error, 'error should be null');
      next();
    });
  },

  (t, next) => {
    t.comment('Confirm the expires value has not been modified');
    getItem(t, item => {
      t.equal(Number(item.expires.N), start + 300, 'expires should be the start time + ttl');
      next();
    });
  },

  (t, next, clock) => {
    t.comment('Advance the clock beyond the touch interval and touch the session');
    clock.tick(100);
    store.touch(id, sessionNoCookie, error => {
      t.false(error, 'error should be null');
      next();
    });
  },

  (t, next, clock) => {
    t.comment('Confirm the expires value has been modified');
    getItem(t, item => {
      t.equal(Number(item.expires.N), clock.now + 300, 'expires should be now + ttl');
      next();
    });
  },

  (t, next) => {
    t.comment('Setting a session with a cookie');
    store.set(id, sessionWithCookie, error => {
      t.false(error, 'error should be null');
      next();
    });
  },

  (t, next, clock) => {
    t.comment('Getting the session with a cookie');
    store.get(id, (error, {foo, lastModified, cookie}) => {
      t.false(error, 'error should be null');
      t.equal(foo, 'moo', 'session.foo should be "moo"');
      t.equal(lastModified, clock.now, 'session.lastModified should be now');
      t.deepEqual(cookie, {expires: 500}, 'cookie should match');
      getItem(t, item => {
        t.equal(Number(item.expires.N), 500, 'expires should be the value from the cookie');
        next();
      });
    });
  },

  (t, next, clock) => {
    t.comment('Advancing the clock to expire the session and trigger cleanup');
    clock.tick(500);
    next(500); // wait for cleanup
  },

  (t, next) => {
    t.comment('Session shouldn\'t exist any more');
    store.get(id, (error, session) => {
      t.false(error, 'error should be null');
      t.false(session, 'session should be null');
      next();
    });
  },

  (t, next) => {
    t.comment('Setting the session again');
    store.set(id, sessionNoCookie, error => {
      t.false(error, 'error should be null');
      next();
    });
  },

  (t, next, clock) => {
    t.comment('Confirm the session exists');
    store.get(id, (error, {foo, lastModified}) => {
      t.false(error, 'error should be null');
      t.equal(foo, 'bar', 'session.foo should be as "bar"');
      t.equal(lastModified, clock.now, 'session.lastModified should be now');
      getItem(t, item => {
        t.equal(Number(item.expires.N), clock.now + 300, 'expires should be now + ttl');
        next();
      });
    });
  },

  (t, next) => {
    t.comment('Delete the session');
    store.destroy(id, error => {
      t.false(error, 'error should be null');
      next();
    });
  },

  (t, next) => {
    t.comment('Session shouldn\'t exist any more');
    store.get(id, (error, session) => {
      t.false(error, 'error should be null');
      t.false(session, 'session should be null');
      next();
    });
  },

  /*
  TODO: get these tests working, currently when `clock.tick()` is called, the cleanup
  function is called, but Date.now() seems to be returning the value from the previous
  tick so the scan filter is not created correctly.

  (t, next) => {
    console.log('seeding 1500 sessions, this may take a few seconds...');
    const ids = Array.apply(null, Array(1500)).map((_, i) => i.toString());
    // use a handy json file
    const s = require('../../package.json');

    Promise.each(ids, i => Promise.fromCallback(cb => store.set(i, s, cb)))
      .catch(e => console.log(e))
      .then(() => {
        t.comment('Seeded 1500 sessions');
        next(1000);
      });
  },

  (t, next) => {
    t.comment('Confirming more than one page of results exists');
    awsClient.scan({
      TableName: 'foo',
      FilterExpression: 'expires < :when',
      ExpressionAttributeValues: {':when': {N: '20000'}},
      ProjectionExpression: 'id'
    }, (error, data) => {
      console.log(error, data);
      t.true(data.LastEvaluatedKey, 'must have last evaluated key');
      next();
    });
  },

  (t, next, clock) => {
    t.comment('Advancing the clock to expire the session and trigger cleanup');
    clock.tick(10000);
    next(10000);
  },

  (t, next) => {
    t.comment('Confirming all the sessions wehre deleted');
    awsClient.scan({
      TableName: 'foo',
      FilterExpression: 'expires < :when',
      ExpressionAttributeValues: {':when': {N: '20000'}},
      ProjectionExpression: 'id'
    }, (error, data) => {
      t.equal(data.Count, 0, 'must have deleted everything');
      t.false(data.LastEvaluatedKey, 'must have not have a last evaluated key');
      next();
    });
  },
   */

  (t, next) => {
    t.comment('Done testing');
    t.end();
    next();
  }
], start, 500)
.on('end', () => {
  console.log('killing local dynamodb');
  localdb.kill();
});
