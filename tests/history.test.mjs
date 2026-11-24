import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryStore } from '../storage.js';

const KEY = 'stb_v1_history';
const TODAY = '2026-11-24';
const RESULT = {
  mode: 'daily', seed: TODAY, day: 16, score: 10, rolls: 6,
  streak: 5, mask: '101111101', perfect: false,
};

// Minimal Web Storage double — same surface the app uses.
function shim(overrides = {}) {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : overrides.getItem ? overrides.getItem(k) : null),
    setItem: (k, v) => {
      if (overrides.setItem) return overrides.setItem(k, v);
      map.set(k, String(v));
    },
  };
}

test('save → load roundtrip: a daily result is stored under its UTC date key and read back', () => {
  const storage = shim();
  const store = createHistoryStore(() => storage, KEY);
  store.save(TODAY, RESULT);
  const history = store.load();
  assert.equal(history[TODAY].score, 10);
  assert.equal(history[TODAY].rolls, 6);
  assert.deepEqual(JSON.parse(storage.getItem(KEY))[TODAY], RESULT);
  assert.equal(store.isBroken(), false);
});

test('unavailable storage (SecurityError on access): load starts fresh and flags broken', () => {
  const store = createHistoryStore(() => {
    throw new DOMException('SecurityError: The document is sandboxed', 'SecurityError');
  }, KEY);
  assert.deepEqual(store.load(), {});
  assert.equal(store.isBroken(), true);
});

test('write-dropping storage (QuotaExceededError on setItem, e.g. private mode): save keeps the in-memory copy and flags broken', () => {
  const storage = shim({ setItem: () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); } });
  const store = createHistoryStore(() => storage, KEY);
  assert.doesNotThrow(() => store.save(TODAY, RESULT));
  assert.equal(store.load()[TODAY].score, 10);
  assert.equal(store.isBroken(), true);
});

test('corrupt stored JSON: load starts fresh instead of crashing', () => {
  const storage = shim();
  storage.setItem(KEY, '{not json');
  const store = createHistoryStore(() => storage, KEY);
  assert.deepEqual(store.load(), {});
  assert.equal(store.isBroken(), true);
});

test('missing storage object (null): treated as unavailable, not a crash', () => {
  const store = createHistoryStore(() => null, KEY);
  assert.deepEqual(store.load(), {});
  assert.equal(store.isBroken(), true);
});
