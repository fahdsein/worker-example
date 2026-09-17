const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_DURATION_MS, normalizeDuration } = require('../task');

test('uses the default duration when no value is supplied', () => {
  assert.equal(normalizeDuration(), DEFAULT_DURATION_MS);
});

test('accepts integer durations at the supported boundaries', () => {
  assert.equal(normalizeDuration(1000), 1000);
  assert.equal(normalizeDuration(60000), 60000);
});

test('rejects invalid durations', () => {
  for (const value of ['1000', 999, 60001, 1000.5, null]) {
    assert.throws(() => normalizeDuration(value), /durationMs/);
  }
});
