'use strict';

import sinon from 'sinon';
import test from 'blue-tape';

export const withFakeTimers = (name, fn, time = 0) => {
  let clock;
  return test(name, t => {
    clock = sinon.useFakeTimers(time);
    fn(t, clock);
  }).on('end', () => clock.restore());
};
