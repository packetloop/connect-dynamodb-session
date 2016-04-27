/* eslint no-underscore-dangle: 0 */

import sinon from 'sinon';
import test from 'blue-tape';

export const withFakeTimers = (name, fn, time = 0) => {
  let clock;
  return test(name, t => {
    clock = sinon.useFakeTimers(time);
    fn(t, clock);
  }).on('end', () => clock.restore());
};

export const sequence = (name, fns, time = 0) => {
  let clock;
  return test(name, t => {
    clock = sinon.useFakeTimers(time);
    const next = (pause = 0) => {
      if (fns.length) {
        clock._setTimeout(() => fns.shift()(t, next, clock), pause);
      }
    };
    next(0);
  }).on('end', () => {
    clock.restore();
  });
};
