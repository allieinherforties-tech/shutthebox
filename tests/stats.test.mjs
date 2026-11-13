import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDay, parseResultBody, applyResult, statsFor,
} from '../worker/src/worker.js';

test('validateDay accepts YYYY-MM-DD today or earlier, rejects the rest', () => {
  assert.equal(validateDay('2026-11-13', '2026-11-13'), '2026-11-13');
  assert.equal(validateDay('2026-11-09', '2026-11-13'), '2026-11-09');
  assert.equal(validateDay('2026-11-14', '2026-11-13'), null); // future
  assert.equal(validateDay('2026-11-13 ', '2026-11-13'), null);
  assert.equal(validateDay('garbage', '2026-11-13'), null);
  assert.equal(validateDay('', '2026-11-13'), null);
  assert.equal(validateDay(null, '2026-11-13'), null);
});

test('parseResultBody accepts a plausible score and derives perfect', () => {
  assert.deepEqual(parseResultBody({ score: 6 }), { score: 6, perfect: false });
  assert.deepEqual(parseResultBody({ score: 0 }), { score: 0, perfect: true });
  // never trusts the posted flag
  assert.deepEqual(parseResultBody({ score: 6, perfect: true }), { score: 6, perfect: false });
  assert.deepEqual(parseResultBody({ score: 45 }), { score: 45, perfect: false });
  assert.equal(parseResultBody({ score: -1 }), null);
  assert.equal(parseResultBody({ score: 46 }), null);
  assert.equal(parseResultBody({ score: 6.5 }), null);
  assert.equal(parseResultBody({ score: '6' }), null);
  assert.equal(parseResultBody(null), null);
  assert.equal(parseResultBody('score'), null);
});

test('applyResult folds a result into an empty row', () => {
  const row = { plays: 0, score_sum: 0, best: 45, perfects: 0 };
  assert.deepEqual(applyResult(row, { score: 6, perfect: false }),
    { plays: 1, score_sum: 6, best: 6, perfects: 0 });
});

test('applyResult folds into an existing row: counts, sum, min-best, perfects', () => {
  const row = { plays: 2, score_sum: 13, best: 3, perfects: 0 };
  assert.deepEqual(applyResult(row, { score: 19, perfect: false }),
    { plays: 3, score_sum: 32, best: 3, perfects: 0 });
  assert.deepEqual(applyResult(row, { score: 0, perfect: true }),
    { plays: 3, score_sum: 13, best: 0, perfects: 1 });
});

test('statsFor returns nulls for an empty day', () => {
  assert.deepEqual(statsFor(null), { plays: 0, avg: null, best: null, perfects: 0 });
  assert.deepEqual(statsFor({ plays: 0, score_sum: 0, best: null, perfects: 0 }),
    { plays: 0, avg: null, best: null, perfects: 0 });
});

test('statsFor computes the average rounded to one decimal', () => {
  assert.deepEqual(statsFor({ plays: 3, score_sum: 19, best: 2, perfects: 0 }),
    { plays: 3, avg: 6.3, best: 2, perfects: 0 });
  assert.deepEqual(statsFor({ plays: 4, score_sum: 20, best: 0, perfects: 1 }),
    { plays: 4, avg: 5, best: 0, perfects: 1 });
});
