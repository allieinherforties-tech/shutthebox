// ============================================================
// Shut the Box — pure game logic (no DOM, no storage).
// Loads in the browser (ES module) and in node (tests).
// ============================================================

// Launch day = Day 1. The daily counter restarts at launch; the old
// "Day 100" numbering does not carry over (spec v0.1, Day-N anchor).
export const LAUNCH_EPOCH = '2026-11-09';

// ---------- Deterministic RNG (mulberry32 + string hash) ----------
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------- Dates (UTC so every player shares the same day) ----------
export function utcDateStr(date = new Date()) {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

export function dayNumber(dateStr, epoch = LAUNCH_EPOCH) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [ey, em, ed] = epoch.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(ey, em - 1, ed)) / 86400000) + 1;
}

// ---------- Dice stream ----------
// Pre-generate a deterministic stream of dice pairs. Every player at roll #k
// sees the same pair.
export function buildDiceStream(seedStr, length = 400) {
  const rng = mulberry32(hashString(seedStr));
  return Array.from({ length }, () => [
    1 + Math.floor(rng() * 6),
    1 + Math.floor(rng() * 6),
  ]);
}

// ---------- Rules ----------
// True if any subset of `values` sums exactly to `target` (empty subset sums to 0).
export function hasCombo(values, target) {
  if (target === 0) return true;
  const avail = values.filter(v => v <= target);
  function rec(i, remaining) {
    if (remaining === 0) return true;
    if (remaining < 0 || i >= avail.length) return false;
    return rec(i + 1, remaining - avail[i]) || rec(i + 1, remaining);
  }
  return rec(0, target);
}

// Sum-based scoring: the score is the sum of the open tile values (lower is better).
export function scoreOf(openValues) {
  return openValues.reduce((a, b) => a + b, 0);
}

// ---------- Challenge links (URL-encoded state, no backend) ----------
// Payload: v (format), seed (dice seed), day (0 for non-daily), sc (score),
// r (rolls), k (best clean streak), m (closed-mask bitstring, 1 = closed), n (name).
// Base64url of UTF-8 bytes, URL-safe and unpadded — shared by challenge and
// transfer codes.
function encodeBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export function encodeChallengeState(ch) {
  const compact = {
    v: 1,
    s: ch.seed,
    d: ch.day || 0,
    c: ch.score,
    r: ch.rolls,
    k: ch.streak,
    m: ch.mask,
    n: (ch.name || '').slice(0, 24),
  };
  return encodeBase64Url(JSON.stringify(compact));
}

export function decodeChallengeState(str) {
  try {
    const o = JSON.parse(decodeBase64Url(str));
    if (!o || o.v !== 1 || typeof o.s !== 'string' || !/^[01]{9}$/.test(o.m || '')) return null;
    return {
      seed: o.s,
      day: o.d || 0,
      score: o.c | 0,
      rolls: Math.max(1, o.r | 0),
      streak: Math.max(0, o.k | 0),
      mask: o.m,
      name: String(o.n || '').slice(0, 24),
    };
  } catch (err) {
    console.warn('Could not read challenge link:', err);
    return null;
  }
}

// ---------- History transfer codes (stateless; the payload rides in the code) ----------
// Same scheme as challenge links: versioned JSON → base64url. Dates collapse to
// integer day numbers and closed-mask bitstrings pack into one integer, so a
// year of daily entries stays a pasteable string (still far beyond QR capacity).
const TRANSFER_VERSION = 1;
// Decode bounds: score is a sum of open tiles (max 1+2+…+9 = 45); the rest are
// generous sanity caps so a truncated or garbled code fails loudly, never softly.
const TRANSFER_LIMITS = { score: 45, rolls: 10000, streak: 99, mask: 511 };

const isInt = n => Number.isInteger(n);

function dateFromDayNumber(day, epoch = LAUNCH_EPOCH) {
  const [ey, em, ed] = epoch.split('-').map(Number);
  return utcDateStr(new Date(Date.UTC(ey, em - 1, ed) + (day - 1) * 86400000));
}

// History shape: { [dateStr]: { mode, seed, day, score, rolls, streak, mask, perfect } }.
// Only dailies are persisted, so mode/seed/day are derivable from the date key
// and never travel in the payload. Entries without a numeric score are skipped.
export function historyToPayload(history) {
  const h = Object.keys(history)
    .filter(dateStr => {
      const r = history[dateStr];
      return r && typeof r.score === 'number';
    })
    .sort()
    .map(dateStr => {
      const r = history[dateStr];
      return [
        dayNumber(dateStr),
        Math.max(0, Math.round(r.score)),
        Math.max(0, Math.round(r.rolls) || 0),
        Math.max(0, Math.round(r.streak) || 0),
        parseInt(r.mask, 2) || 0,
      ];
    });
  return { v: TRANSFER_VERSION, h };
}

// Strict inverse of historyToPayload. Returns null on any schema violation —
// a bad code must fail loudly, never reconstruct corrupt history.
export function payloadToHistory(payload) {
  try {
    if (!payload || payload.v !== TRANSFER_VERSION || !Array.isArray(payload.h)) return null;
    const history = {};
    for (const entry of payload.h) {
      if (!Array.isArray(entry) || entry.length !== 5) return null;
      const [day, score, rolls, streak, mask] = entry;
      if (![day, score, rolls, streak, mask].every(isInt)) return null;
      if (score < 0 || score > TRANSFER_LIMITS.score) return null;
      if (rolls < 0 || rolls > TRANSFER_LIMITS.rolls) return null;
      if (streak < 0 || streak > TRANSFER_LIMITS.streak) return null;
      if (mask < 0 || mask > TRANSFER_LIMITS.mask) return null;
      const dateStr = dateFromDayNumber(day);
      history[dateStr] = {
        mode: 'daily',
        seed: dateStr,
        day: dayNumber(dateStr),
        score,
        rolls,
        streak,
        mask: mask.toString(2).padStart(9, '0'),
        perfect: score === 0,
      };
    }
    return history;
  } catch (err) {
    console.warn('Could not read transfer payload:', err);
    return null;
  }
}

export function encodeHistoryCode(history) {
  return encodeBase64Url(JSON.stringify(historyToPayload(history)));
}

// Tolerates whitespace and line wraps from pasted text; null on any failure.
export function decodeHistoryCode(str) {
  try {
    return payloadToHistory(JSON.parse(decodeBase64Url(String(str).replace(/\s+/g, ''))));
  } catch (err) {
    console.warn('Could not read transfer code:', err);
    return null;
  }
}

// Union of dates; per date the LOWEST score wins, and an equal score keeps
// the record already on the device. Pure: neither argument is mutated, so the
// result can be previewed before anything is stored.
export function mergeHistory(local, incoming) {
  const merged = { ...local };
  for (const [dateStr, rec] of Object.entries(incoming)) {
    const cur = merged[dateStr];
    if (!cur || rec.score < cur.score) merged[dateStr] = rec;
  }
  return merged;
}

export function buildChallengeUrl(base, ch) {
  return base + '?c=' + encodeChallengeState(ch);
}

// Closed-mask bitstring helpers. Index i = tile i+1; '1' = closed.
export function maskFromClosed(closedByValue) {
  return closedByValue.map(closed => (closed ? '1' : '0')).join('');
}

// ---------- History, streaks, heatmap ----------
// history: { [dateStr]: { score, rolls, streak, mask, perfect } } — dailies only.
export function computeStreak(history, todayStr) {
  const played = d => !!history[d];
  let cursor = todayStr;
  if (!played(cursor)) {
    // A streak survives if you played yesterday; today is still open.
    const [y, m, d] = todayStr.split('-').map(Number);
    cursor = utcDateStr(new Date(Date.UTC(y, m - 1, d) - 86400000));
    if (!played(cursor)) return 0;
  }
  let n = 0;
  while (played(cursor)) {
    n++;
    const [y, m, d] = cursor.split('-').map(Number);
    cursor = utcDateStr(new Date(Date.UTC(y, m - 1, d) - 86400000));
  }
  return n;
}

// Heatmap intensity buckets (lower score is better; 0 = Shut the Box).
export function heatBucket(result) {
  if (!result) return 'none';
  if (result.score === 0) return 'shut';
  if (result.score <= 12) return 'sharp';
  if (result.score <= 24) return 'solid';
  return 'played';
}

// A date is archive-playable when it is strictly before today. String
// comparison is safe for ISO YYYY-MM-DD dates.
export function isPastDay(dateStr, todayStr) {
  return dateStr < todayStr;
}

// A past day is replayable only from launch onward — earlier dates never had
// a daily challenge (dayNumber goes negative before LAUNCH_EPOCH).
export function isReplayableDay(dateStr, todayStr, epoch = LAUNCH_EPOCH) {
  return isPastDay(dateStr, todayStr) && dateStr >= epoch;
}

export function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
