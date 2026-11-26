import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAUNCH_EPOCH, dayNumber,
  historyToPayload, payloadToHistory,
  encodeHistoryCode, decodeHistoryCode,
  mergeHistory,
} from '../logic.js';

const DAY1 = LAUNCH_EPOCH; // day number 1
const DAY2 = '2026-11-10';
const DAY3 = '2026-11-11';

function result(dateStr, score, overrides = {}) {
  return {
    mode: 'daily', seed: dateStr, day: dayNumber(dateStr),
    score, rolls: 6, streak: 3, mask: '011111111', perfect: score === 0,
    ...overrides,
  };
}

// ---------- Round trip ----------

test('encode → decode round trip: every date keeps score, rolls, streak, and mask', () => {
  const history = {
    [DAY1]: result(DAY1, 10, { rolls: 5, streak: 4, mask: '101111101' }),
    [DAY2]: result(DAY2, 0, { rolls: 7, streak: 7, mask: '111111111', perfect: true }),
    [DAY3]: result(DAY3, 33, { rolls: 9, streak: 1, mask: '001100011' }),
  };
  const decoded = decodeHistoryCode(encodeHistoryCode(history));
  assert.deepEqual(decoded, history);
});

test('round trip rebuilds mode/seed/day/perfect from the date key, not the payload', () => {
  const history = { [DAY2]: result(DAY2, 12) };
  const decoded = decodeHistoryCode(encodeHistoryCode(history));
  assert.equal(decoded[DAY2].mode, 'daily');
  assert.equal(decoded[DAY2].seed, DAY2);
  assert.equal(decoded[DAY2].day, dayNumber(DAY2));
  assert.equal(decoded[DAY2].perfect, false);
});

test('an empty history encodes to an empty merge result, not null', () => {
  assert.deepEqual(decodeHistoryCode(encodeHistoryCode({})), {});
});

test('export skips entries without a numeric score instead of encoding NaN', () => {
  const decoded = decodeHistoryCode(encodeHistoryCode({ [DAY1]: { rolls: 3 } }));
  assert.deepEqual(decoded, {});
});

// ---------- Merge rules ----------

test('merge: union of dates — days only on one side survive', () => {
  const local = { [DAY1]: result(DAY1, 10) };
  const incoming = { [DAY3]: result(DAY3, 20) };
  const merged = mergeHistory(local, incoming);
  assert.deepEqual(Object.keys(merged).sort(), [DAY1, DAY3]);
});

test('merge: lowest score per day wins, bringing its whole record', () => {
  const local = { [DAY1]: result(DAY1, 12, { rolls: 9, streak: 1, mask: '001111111' }) };
  const incoming = { [DAY1]: result(DAY1, 5, { rolls: 4, streak: 6, mask: '110000111' }) };
  const merged = mergeHistory(local, incoming);
  assert.equal(merged[DAY1].score, 5);
  assert.deepEqual(merged[DAY1], incoming[DAY1]);
});

test('merge: equal scores keep the local record', () => {
  const local = { [DAY1]: result(DAY1, 8, { rolls: 6 }) };
  const incoming = { [DAY1]: result(DAY1, 8, { rolls: 11 }) };
  const merged = mergeHistory(local, incoming);
  assert.equal(merged[DAY1].rolls, 6);
});

test('merge: neither argument is mutated and the result is previewable', () => {
  const local = { [DAY1]: result(DAY1, 10) };
  const incoming = { [DAY1]: result(DAY1, 5), [DAY3]: result(DAY3, 20) };
  const localCopy = JSON.parse(JSON.stringify(local));
  const incomingCopy = JSON.parse(JSON.stringify(incoming));
  const merged = mergeHistory(local, incoming);
  assert.deepEqual(local, localCopy);
  assert.deepEqual(incoming, incomingCopy);
  assert.notEqual(merged, local);
});

test('merge: importing a code into itself changes nothing', () => {
  const history = { [DAY1]: result(DAY1, 10), [DAY2]: result(DAY2, 0) };
  assert.deepEqual(mergeHistory(history, decodeHistoryCode(encodeHistoryCode(history))), history);
});

// ---------- Bad codes fail loudly ----------

test('invalid codes: truncated base64, wrong version, and garbage all return null', () => {
  const good = encodeHistoryCode({ [DAY1]: result(DAY1, 10) });
  assert.equal(decodeHistoryCode(good.slice(0, good.length - 4)), null); // truncated
  assert.equal(decodeHistoryCode('not a code at all'), null);
  assert.equal(decodeHistoryCode(''), null);
  const payload = JSON.parse(Buffer.from(good.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  payload.v = 2;
  const v2 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.equal(decodeHistoryCode(v2), null);
});

test('out-of-range tuple fields are rejected: score, rolls, streak, mask', () => {
  const bad = (entry) => Buffer.from(JSON.stringify({ v: 1, h: [entry] })).toString('base64url');
  assert.equal(decodeHistoryCode(bad([1, 46, 6, 3, 0])), null);   // score above 45
  assert.equal(decodeHistoryCode(bad([1, -1, 6, 3, 0])), null);   // score below 0
  assert.equal(decodeHistoryCode(bad([1, 10, 10001, 3, 0])), null); // rolls
  assert.equal(decodeHistoryCode(bad([1, 10, 6, 100, 0])), null); // streak
  assert.equal(decodeHistoryCode(bad([1, 10, 6, 3, 512])), null); // mask
  assert.equal(decodeHistoryCode(bad([1, 10, 6, 3, '011111111'])), null); // unpacked mask
});

test('malformed payloads: non-array h, wrong tuple arity, non-integer fields', () => {
  const bad = (body) => Buffer.from(JSON.stringify(body)).toString('base64url');
  assert.equal(decodeHistoryCode(bad({ v: 1, h: 'nope' })), null);
  assert.equal(decodeHistoryCode(bad({ v: 1, h: [[1, 10, 6]] })), null);
  assert.equal(decodeHistoryCode(bad({ v: 1, h: [[1.5, 10, 6, 3, 0]] })), null);
  assert.equal(decodeHistoryCode(bad({ v: 1, h: [['x', 10, 6, 3, 0]] })), null);
  assert.equal(decodeHistoryCode(bad({ v: 1 })), null);
});

// ---------- End-to-end acceptance: export on A + import on B ----------

test('device A exports, device B merges: union of dates with best score per day', () => {
  const historyA = {
    [DAY1]: result(DAY1, 10, { rolls: 5, streak: 4, mask: '101111101' }),
    [DAY2]: result(DAY2, 7),
  };
  const historyB = {
    [DAY2]: result(DAY2, 20, { rolls: 11, streak: 0, mask: '000000011' }),
    [DAY3]: result(DAY3, 3),
  };
  // On device B: paste A's code, preview, confirm.
  const decoded = decodeHistoryCode(encodeHistoryCode(historyA));
  assert.notEqual(decoded, null);
  const merged = mergeHistory(historyB, decoded);
  assert.equal(Object.keys(merged).length, 3);
  assert.equal(merged[DAY1].score, 10); // from A
  assert.equal(merged[DAY2].score, 7);  // A's best beats B's 20
  assert.equal(merged[DAY3].score, 3);  // from B
  // Storage on B holds exactly the merged history.
  assert.deepEqual(JSON.parse(JSON.stringify(merged)), {
    [DAY1]: historyA[DAY1], [DAY2]: historyA[DAY2], [DAY3]: historyB[DAY3],
  });
});
