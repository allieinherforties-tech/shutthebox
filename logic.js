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
// sees the same pair; a single-die roll consumes the same slot's first die.
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

// The single-die option opens once tiles 7, 8 and 9 are all closed (GDD §2).
export function singleDieEligible(openValues) {
  return ![7, 8, 9].some(v => openValues.includes(v));
}

// Sum-based scoring: the score is the sum of the open tile values (lower is better).
export function scoreOf(openValues) {
  return openValues.reduce((a, b) => a + b, 0);
}

// ---------- Challenge links (URL-encoded state, no backend) ----------
// Payload: v (format), seed (dice seed), day (0 for non-daily), sc (score),
// r (rolls), k (best clean streak), m (closed-mask bitstring, 1 = closed), n (name).
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
  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeChallengeState(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes));
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

export function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
