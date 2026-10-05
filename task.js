const DEFAULT_DURATION_MS = 10000;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 60000;

function normalizeDuration(value) {
  if (value === undefined) return DEFAULT_DURATION_MS;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError('durationMs must be an integer number of milliseconds.');
  }
  if (value < MIN_DURATION_MS || value > MAX_DURATION_MS) {
    throw new RangeError(`durationMs must be between ${MIN_DURATION_MS} and ${MAX_DURATION_MS} milliseconds.`);
  }
  return value;
}

export { DEFAULT_DURATION_MS, MIN_DURATION_MS, MAX_DURATION_MS, normalizeDuration };
