// Shut the Box — aggregate stats API (Cloudflare Worker + D1).
//
// Records daily results and returns aggregate counts. Daily plays only:
// casual and friend-challenge rounds use per-player dice, so their scores
// are not comparable across players and are excluded.
//
// Privacy: aggregate-only storage (per-day counters) — no per-player rows,
// nothing identifiable, nothing that reconstructs a board.
//
// NOTE: the write endpoint is unauthenticated by design (public static app);
// inflated counts are accepted. Fine for the prototype — revisit if abused.

const SITE_ORIGIN = 'https://shutthebox.olivejuice.digital';
const MAX_SCORE = 45; // nine tiles, all still open
const MAX_BODY_CHARS = 200;

function corsHeaders(origin) {
  const allow = origin === SITE_ORIGIN || (origin || '').startsWith('http://localhost')
    ? origin
    : SITE_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// Accepts YYYY-MM-DD, today (UTC) or earlier — never a future day.
export function validateDay(day, todayStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
  if (day > todayStr) return null;
  return day;
}

// Score must be a plausible tile sum; `perfect` is always derived, never trusted.
export function parseResultBody(body) {
  if (!body || typeof body !== 'object') return null;
  const { score } = body;
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return null;
  return { score, perfect: score === 0 };
}

// Pure aggregate fold — unit-tested in node, applied to a D1 row at runtime.
export function applyResult(row, { score, perfect }) {
  return {
    plays: row.plays + 1,
    score_sum: row.score_sum + score,
    best: Math.min(row.best, score),
    perfects: row.perfects + (perfect ? 1 : 0),
  };
}

export function statsFor(row) {
  if (!row || !row.plays) return { plays: 0, avg: null, best: null, perfects: 0 };
  return {
    plays: row.plays,
    avg: Math.round((row.score_sum / row.plays) * 10) / 10,
    best: row.best,
    perfects: row.perfects,
  };
}

async function getStats(url, env, headers) {
  const today = new Date().toISOString().slice(0, 10);
  const day = validateDay(url.searchParams.get('day'), today);
  if (day) {
    const row = await env.DB.prepare(
      'SELECT plays, score_sum, best, perfects FROM day_stats WHERE day = ?1'
    ).bind(day).first();
    return json({ day, ...statsFor(row) }, 200, headers);
  }
  const { results } = await env.DB.prepare(
    `SELECT day, plays, score_sum, best, perfects FROM day_stats
     ORDER BY day DESC LIMIT 30`
  ).all();
  const days = (results || []).map((row) => {
    const { plays, avg, best, perfects } = statsFor(row);
    return { day: row.day, plays, avg, best, perfects };
  });
  return json({ days }, 200, headers);
}

async function postResult(request, env, headers) {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: 'payload too large' }, 413, headers);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid JSON' }, 400, headers);
  }
  const today = new Date().toISOString().slice(0, 10);
  const day = validateDay(body.day, today);
  if (!day) return json({ error: 'invalid day' }, 400, headers);
  const result = parseResultBody(body);
  if (!result) return json({ error: 'invalid result' }, 400, headers);

  await env.DB.prepare(
    `INSERT INTO day_stats (day, plays, score_sum, best, perfects)
     VALUES (?1, 1, ?2, ?2, ?3)
     ON CONFLICT(day) DO UPDATE SET
       plays = plays + 1,
       score_sum = score_sum + excluded.score_sum,
       best = MIN(best, excluded.best),
       perfects = perfects + excluded.perfects`
  ).bind(day, result.score, result.perfect ? 1 : 0).run();

  const row = await env.DB.prepare(
    'SELECT plays, score_sum, best, perfects FROM day_stats WHERE day = ?1'
  ).bind(day).first();
  return json({ ok: true, day, ...statsFor(row) }, 200, headers);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      if (request.method === 'GET' && url.pathname === '/api/stats') return await getStats(url, env, headers);
      if (request.method === 'POST' && url.pathname === '/api/result') return await postResult(request, env, headers);
      return json({ error: 'not found' }, 404, headers);
    } catch (err) {
      // Surface in `wrangler tail`; the client sees a plain 500.
      console.error('worker error', err);
      return json({ error: 'internal error' }, 500, headers);
    }
  },
};
