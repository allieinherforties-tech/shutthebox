import test from 'node:test';
import assert from 'node:assert/strict';
import {
  utcDateStr, dayNumber, buildDiceStream, isPastDay, computeStreak,
} from '../logic.js';
import { createHistoryStore } from '../storage.js';

const KEY = 'stb_v1_history';
const TODAY = '2026-11-24';        // Day 16
const PAST = '2026-11-12';         // Day 4
const PAST_MINUS_1 = '2026-11-11'; // Day 3

const RESULT_FOR = (ds, score) => ({
  mode: 'daily', seed: ds, day: dayNumber(ds), score,
  rolls: 6, streak: 3, mask: '101111101', perfect: false,
});

// ---------- isPastDay: the gate that makes a heat cell replayable ----------

test('isPastDay: strictly-before today is playable, today and future are not', () => {
  assert.equal(isPastDay('2026-11-23', TODAY), true);
  assert.equal(isPastDay('2026-11-09', TODAY), true);   // launch day itself
  assert.equal(isPastDay(TODAY, TODAY), false);          // today plays from Home
  assert.equal(isPastDay('2026-11-25', TODAY), false);   // future
  assert.equal(isPastDay('2027-01-01', TODAY), false);   // far future
});

// ---------- dayNumber / seed correctness for past dates ----------

test('dayNumber computes the correct Day for an archive date', () => {
  assert.equal(dayNumber('2026-11-09'), 1);   // launch
  assert.equal(dayNumber(PAST_MINUS_1), 3);
  assert.equal(dayNumber(PAST), 4);
  assert.equal(dayNumber(TODAY), 16);
});

test('an archive date seeds its own deterministic dice stream, distinct from today\'s', () => {
  const archive = buildDiceStream(PAST);
  const again = buildDiceStream(PAST);
  const live = buildDiceStream(TODAY);
  assert.equal(archive.length, live.length);
  assert.deepEqual(archive, again);          // stable across replays
  assert.notDeepEqual(archive, live);        // different day, different dice
});

test('utcDateStr of a past date is the archive seed (YYYY-MM-DD, UTC)', () => {
  const dt = new Date(PAST + 'T00:00:00Z');
  assert.equal(utcDateStr(dt), PAST);
});

// ---------- history-save path for archive rounds ----------

test('an archive result is saved under its own date key without clobbering today', () => {
  const store = createHistoryStore(() => {
    const map = new Map();
    return {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
    };
  }, KEY);
  store.save(TODAY, RESULT_FOR(TODAY, 10));
  store.save(PAST, RESULT_FOR(PAST, 18));
  const history = store.load();
  assert.equal(history[TODAY].score, 10);
  assert.equal(history[PAST].score, 18);
  assert.equal(history[PAST].day, 4);
  assert.equal(Object.keys(history).length, 2);
  assert.equal(store.isBroken(), false);
});

// ---------- backfilled consecutive days extend the streak ----------

test('backfilling consecutive past days extends computeStreak', () => {
  const store = createHistoryStore(() => {
    const map = new Map();
    return {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
    };
  }, KEY);
  // Yesterday and the day before were missed, then replayed from the archive.
  store.save('2026-11-22', RESULT_FOR('2026-11-22', 12));
  store.save('2026-11-23', RESULT_FOR('2026-11-23', 9));
  const history = store.load();
  // Today unplayed: streak survives through yesterday's backfilled run.
  assert.equal(computeStreak(history, TODAY), 2);
  // Completing today's live challenge extends the backfilled run to 3.
  history[TODAY] = RESULT_FOR(TODAY, 14);
  assert.equal(computeStreak(history, TODAY), 3);
});

test('a gap before backfilled days does not create a streak', () => {
  const history = { [PAST]: RESULT_FOR(PAST, 20) }; // Day 4, nothing since
  assert.equal(computeStreak(history, TODAY), 0);
});
