'use strict';

import dynamo from './dynamo';

const numberOr = (n, defaultVal) => {
  if (typeof n === 'number') return n;
  return defaultVal;
};

export default ({Store}) => {
  class DynamoStore extends Store {
    constructor(options = {}) {
      super(options);

      if (typeof options.tableName !== 'string') {
        throw new TypeError('tableName must be a string');
      }

      this.client = options.client || dynamo(options);
      this.ttl = numberOr(options.ttl, 14 * 24 * 60 * 60 * 1000); // default two weeks
      this.cleanupInterval = numberOr(options.cleanupInterval, 5 * 60 * 1000); // default 5 minutes
      this.touchAfter = numberOr(options.touchAfter, 10 * 1000); // default ten seconds
      this.err = options.err || (() => {});
      this.log = options.log || (() => {});
      this.client.init(options.autoCreate)
        .then(() => this.log(`SessionStore connected to ${options.tableName}`))
        .catch(e => this.err(`Unable to connect to ${options.tableName}`, e))
        .then(() => {
          if (this.cleanupInterval > 0) {
            global.setTimeout(this.cleanup.bind(this), this.cleanupInterval);
          }
        });
    }

    getExpires(session) {
      if (session && session.cookie && session.cookie.expires) {
        return new Date(session.cookie.expires).getTime();
      }
      return Date.now() + this.ttl;
    }

    cleanup() {
      // make sure we don't delete sessions that are waiting to be touched, add another 5 seconds
      // so we don't have to do a consistent read
      const aWhileAgo = Date.now() - this.touchAfter - 5000;
      this.client.deleteExpired(aWhileAgo)
        .then(({scanned, deleted}) =>
          this.log(`SessionStore scanned ${scanned} rows and removed ${deleted} expired sessions \
running again in ${this.cleanupInterval / 1000} seconds.`)
        )
        .catch(e => this.err('Unable to remove expired sessions', e))
        .then(() => global.setTimeout(this.cleanup.bind(this), this.cleanupInterval));
    }

    // Public API

    get(sid, callback) {
      this.client.get(sid)
        .then(data => {
          // only return sessions that haven't expired
          if (data && Date.now() <= data.expires) {
            callback(null, data.content);
          } else {
            callback(null, null);
          }
        })
        .catch(error => {
          this.err(`Unable to get session sid:${sid}`, error);
          callback(error);
        });
    }

    set(sid, session, callback) {
      const expires = this.getExpires(session);
      if (this.touchAfter > 0) {
        session.lastModified = Date.now(); // eslint-disable-line no-param-reassign
      }

      console.log('setting');
      this.client.put(sid, expires, session)
        .then(() => callback(null))
        .catch(error => {
          this.err(`Unable to save session sid:${sid}`, error);
          callback(error);
        });
    }

    touch(sid, session, callback) {
      if (this.touchAfter > 0) {
        if (Date.now() - session.lastModified < this.touchAfter) {
          callback(null);
        } else {
          session.lastModified = Date.now(); // eslint-disable-line no-param-reassign
          this.set(sid, session, callback);
        }
      } else {
        this.client.setExpires(sid, this.getExpires(session))
          .then(() => callback(null))
          .catch(error => {
            this.err(`Unable to touch session sid:${sid}`, error);
            callback(error);
          });
      }
    }

    destroy(sid, callback) {
      this.client.delete(sid)
        .then(() => callback(null))
        .catch(error => {
          this.err(`Unable to delete session sid:${sid}`, error);
          callback(error);
        });
    }
  }

  return DynamoStore;
};
