import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, hashString, utcDateStr, dayNumber, buildDiceStream,
  hasCombo, singleDieEligible, scoreOf,
  encodeChallengeState, decodeChallengeState, buildChallengeUrl,
  maskFromClosed, computeStreak, heatBucket,
} from '../logic.js';

test('mulberry32 is deterministic for the same seed', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  for (const x of seqA) assert.ok(x >= 0 && x < 1);
});

test('hashString is stable', () => {
  assert.equal(hashString('2026-11-09'), hashString('2026-11-09'));
  assert.notEqual(hashString('2026-11-09'), hashString('2026-11-10'));
});

test('dayNumber anchors Day 1 at launch', () => {
  assert.equal(dayNumber('2026-11-09'), 1);
  assert.equal(dayNumber('2026-11-10'), 2);
  assert.equal(dayNumber('2026-11-16'), 8);
  assert.equal(dayNumber('2026-11-08'), 0);
});

test('dice stream is deterministic per seed and within 1–6', () => {
  const s1 = buildDiceStream('2026-11-09');
  const s2 = buildDiceStream('2026-11-09');
  assert.deepEqual(s1, s2);
  assert.equal(s1.length, 400);
  for (const [a, b] of s1) {
    assert.ok(a >= 1 && a <= 6 && b >= 1 && b <= 6);
  }
  // Fixed expected values — catches accidental drift in the shared daily sequence.
  assert.deepEqual(buildDiceStream('2026-11-09')[0], [3, 3]);
  assert.deepEqual(buildDiceStream('2026-11-10')[0], [6, 1]);
});

test('hasCombo finds subset sums', () => {
  assert.equal(hasCombo([1, 2, 3], 6), true);
  assert.equal(hasCombo([2, 4], 6), true);
  assert.equal(hasCombo([2, 4], 1), false);
  assert.equal(hasCombo([], 0), true);
  assert.equal(hasCombo([], 5), false);
  assert.equal(hasCombo([5], 5), true);
  assert.equal(hasCombo([1, 3, 5, 7], 9), true);  // 1+3+5
  assert.equal(hasCombo([2, 6], 45), false);
});

test('singleDieEligible requires 7, 8 and 9 all closed (argument = open values)', () => {
  assert.equal(singleDieEligible([1, 2, 3, 4, 5, 6]), true);
  assert.equal(singleDieEligible([1, 2, 3, 4, 5, 6, 7]), false);
  assert.equal(singleDieEligible([8]), false);
  assert.equal(singleDieEligible([9]), false);
  assert.equal(singleDieEligible([1, 9, 8]), false);
  assert.equal(singleDieEligible([7, 8, 9]), false); // 7–9 still open → two dice only
});

test('scoreOf sums open tiles', () => {
  assert.equal(scoreOf([]), 0);
  assert.equal(scoreOf([2, 4]), 6);
  assert.equal(scoreOf([1, 2, 3, 4, 5, 6, 7, 8, 9]), 45);
});

test('challenge state round-trips, including unicode names', () => {
  const ch = {
    seed: '2026-11-09', day: 1, score: 14, rolls: 6, streak: 3,
    mask: '111000101', name: 'Allié 🎲',
  };
  const encoded = encodeChallengeState(ch);
  assert.doesNotMatch(encoded, /[+/=]/); // URL-safe
  const decoded = decodeChallengeState(encoded);
  assert.deepEqual(decoded, ch);
});

test('challenge URL is built with ?c= payload', () => {
  const url = buildChallengeUrl('https://shutthebox.olivejuice.digital/', {
    seed: '2026-11-09', day: 1, score: 9, rolls: 5, streak: 2, mask: '111111000', name: 'Sam',
  });
  assert.ok(url.startsWith('https://shutthebox.olivejuice.digital/?c='));
  const decoded = decodeChallengeState(url.split('?c=')[1]);
  assert.equal(decoded.score, 9);
  assert.equal(decoded.name, 'Sam');
  assert.equal(decoded.seed, '2026-11-09');
});

test('decodeChallengeState rejects garbage without throwing', () => {
  assert.equal(decodeChallengeState('not-a-real-payload'), null);
  assert.equal(decodeChallengeState(''), null);
  // Valid base64 but wrong structure/version
  const bad = encodeChallengeState({ seed: 'x', day: 0, score: 1, rolls: 1, streak: 0, mask: 'XX', name: '' });
  assert.equal(decodeChallengeState(bad), null);
});

test('maskFromClosed maps closed tiles to bits', () => {
  assert.equal(maskFromClosed([true, false, true, true, true, true, true, true, true]), '101111111');
  assert.equal(maskFromClosed([false, false, false, false, false, false, false, false, false]), '000000000');
});

test('computeStreak counts consecutive days through yesterday when today is unplayed', () => {
  const h1 = { '2026-11-07': { score: 10 }, '2026-11-08': { score: 12 } };
  assert.equal(computeStreak(h1, '2026-11-09'), 2);   // today open, yesterday+day before played
  const h2 = { ...h1, '2026-11-09': { score: 9 } };
  assert.equal(computeStreak(h2, '2026-11-09'), 3);   // today played, extends the streak
  const h3 = { '2026-11-05': { score: 10 } };
  assert.equal(computeStreak(h3, '2026-11-09'), 0);   // gap before today
  assert.equal(computeStreak({}, '2026-11-09'), 0);
});

test('heatBucket buckets by score', () => {
  assert.equal(heatBucket(null), 'none');
  assert.equal(heatBucket({ score: 0 }), 'shut');
  assert.equal(heatBucket({ score: 12 }), 'sharp');
  assert.equal(heatBucket({ score: 13 }), 'solid');
  assert.equal(heatBucket({ score: 24 }), 'solid');
  assert.equal(heatBucket({ score: 25 }), 'played');
});

test('utcDateStr formats in UTC', () => {
  assert.equal(utcDateStr(new Date(Date.UTC(2026, 10, 9, 23, 59))), '2026-11-09');
  assert.equal(utcDateStr(new Date(Date.UTC(2026, 0, 1))), '2026-01-01');
});
