// ============================================================
// Shut the Box — app wiring (DOM, storage, flows).
// Pure rules live in logic.js.
// ============================================================
import {
  utcDateStr, dayNumber, buildDiceStream, hasCombo,
  singleDieEligible, scoreOf, decodeChallengeState,
  buildChallengeUrl, maskFromClosed, computeStreak, heatBucket, formatDateShort,
} from './logic.js';

const el = id => document.getElementById(id);
const TOOLTIP_TEXT = 'Rolling one die guarantees a result of 1–6, instead of a two-dice roll that could total anywhere from 2–12';

// ---------- Storage (dailies only; casual/challenge rounds are never persisted) ----------
const STORE_KEY = 'stb_v1_history';
const NAME_KEY = 'stb_v1_name';
let memoryHistory = null; // fallback when localStorage is unavailable

function loadHistory() {
  if (memoryHistory) return memoryHistory;
  try {
    memoryHistory = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch (err) {
    console.warn('History unreadable, starting fresh:', err);
    memoryHistory = {};
  }
  return memoryHistory;
}

function saveDailyResult(dateStr, result) {
  const history = loadHistory();
  history[dateStr] = result;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('Could not persist history:', err);
  }
}

function loadName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch (err) { console.warn('Could not save name:', err); }
}

// ---------- Shared "today" state ----------
const TODAY = utcDateStr();
const DAY = dayNumber(TODAY);
let lastResult = null;   // most recent completed round (daily, casual, or challenge)
let challengeIncoming = null; // decoded challenge link, while active

// ---------- Screens ----------
const SCREENS = ['home', 'how', 'game', 'result', 'challenge', 'invite', 'compare', 'history'];
function showScreen(name) {
  SCREENS.forEach(s => el('screen-' + s).classList.toggle('active', s === name));
  hideTooltip();
  window.scrollTo(0, 0);
}

// ---------- Toast ----------
let toastT;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 1900);
}

// ---------- Game state ----------
const game = {
  mode: 'daily',      // daily | casual | challenge
  seed: '',
  day: 0,
  stream: [],
  tiles: [],          // { value, open }
  rollIndex: 0,
  dice: [],
  rollTotal: 0,
  phase: 'idle',      // idle | selecting | ended
  selected: new Set(),
  rolls: 0,
  cleanCur: 0,
  cleanBest: 0,
};

function openValues() { return game.tiles.filter(t => t.open).map(t => t.value); }

function resetGame(mode, seed, day) {
  Object.assign(game, {
    mode, seed, day: day || 0,
    stream: buildDiceStream(seed),
    tiles: Array.from({ length: 9 }, (_, i) => ({ value: i + 1, open: true })),
    rollIndex: 0, dice: [], rollTotal: 0, phase: 'idle',
    selected: new Set(), rolls: 0, cleanCur: 0, cleanBest: 0,
  });
}

function startGame(mode, seed, day) {
  resetGame(mode, seed, day);
  el('game-title').textContent = mode === 'daily' ? 'Daily Challenge' : mode === 'challenge' ? 'Friend Challenge' : 'Casual Round';
  el('game-day').textContent = mode === 'daily' ? 'Day ' + game.day : mode === 'challenge' ? (game.day ? 'Day ' + game.day : 'Friendly') : 'Casual';
  renderTiles();
  renderDice(false);
  el('hint').textContent = '';
  setStatus('Roll to begin');
  renderControls();
  showScreen('game');
}

// ---------- Board rendering (two rows of standing tiles, ≥44px targets) ----------
function renderTiles() {
  const wrap = el('tiles');
  wrap.innerHTML = '';
  const rows = [game.tiles.slice(0, 5), game.tiles.slice(5, 9)];
  rows.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'tile-row';
    row.forEach(t => {
      const b = document.createElement('button');
      b.className = 'tile';
      b.dataset.value = t.value;
      b.type = 'button';
      b.textContent = t.value;
      b.appendChild(Object.assign(document.createElement('span'), { className: 'peg', 'aria-hidden': 'true' }));
      if (!t.open) {
        b.classList.add('closed');
        b.disabled = true;
        b.setAttribute('aria-label', 'Tile ' + t.value + ' closed');
      } else if (game.phase === 'selecting') {
        if (game.selected.has(t.value)) b.classList.add('selected');
        b.addEventListener('click', () => toggleTile(t.value));
      } else {
        b.disabled = true;
      }
      rowEl.appendChild(b);
    });
    wrap.appendChild(rowEl);
  });
}

function pipLayout(n) {
  const M = {
    1: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    2: [1, 0, 0, 0, 0, 0, 0, 0, 1],
    3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    4: [1, 0, 1, 0, 0, 0, 1, 0, 1],
    5: [1, 0, 1, 0, 1, 0, 1, 0, 1],
    6: [1, 0, 1, 1, 0, 1, 1, 0, 1],
  };
  return M[n] || M[1];
}

function renderDice(rolling) {
  const wrap = el('dice');
  wrap.innerHTML = '';
  game.dice.forEach(v => {
    const die = document.createElement('div');
    die.className = 'die' + (rolling ? ' rolling' : '');
    die.dataset.value = v;
    pipLayout(v).forEach(on => {
      const cell = document.createElement('span');
      if (on) cell.className = 'pip';
      die.appendChild(cell);
    });
    wrap.appendChild(die);
  });
}

function sumSelected() {
  let s = 0;
  game.selected.forEach(v => { s += v; });
  return s;
}

function setStatus(html, mode) {
  const s = el('status');
  s.className = 'status-pill' + (mode ? ' ' + mode : '');
  s.innerHTML = html;
}

// ---------- Controls + single-die tooltip ----------
function hideTooltip() {
  const tip = document.getElementById('tooltip');
  if (tip) tip.classList.add('hidden');
}

function renderTooltip() {
  const tip = document.createElement('div');
  tip.className = 'tooltip hidden';
  tip.id = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = TOOLTIP_TEXT;
  return tip;
}

function renderControls() {
  const c = el('controls');
  c.innerHTML = '';
  if (game.phase === 'idle') {
    const group = document.createElement('div');
    group.className = 'roll-group';
    const row = document.createElement('div');
    row.className = 'roll-row';
    const eligible = singleDieEligible(openValues());
    const rollBtn = document.createElement('button');
    rollBtn.className = 'btn btn-primary';
    rollBtn.type = 'button';
    rollBtn.textContent = 'Roll';
    rollBtn.addEventListener('click', () => { hideTooltip(); doRoll(false); });
    row.appendChild(rollBtn);
    if (eligible) {
      const one = document.createElement('button');
      one.className = 'btn btn-ghost';
      one.type = 'button';
      one.textContent = 'Roll one die';
      one.addEventListener('click', () => { hideTooltip(); doRoll(true); });
      const info = document.createElement('button');
      info.className = 'info-btn';
      info.type = 'button';
      info.id = 'btn-die-info';
      info.setAttribute('aria-label', 'Why roll one die?');
      info.setAttribute('aria-expanded', 'false');
      info.textContent = 'i';
      info.addEventListener('click', toggleTooltip);
      row.appendChild(one);
      row.appendChild(info);
      el('hint').textContent = 'Tiles 7–9 are down — you may roll a single die.';
      showTooltipOnce();
    } else {
      el('hint').textContent = '';
    }
    group.appendChild(row);
    group.appendChild(renderTooltip());
    c.appendChild(group);
  } else if (game.phase === 'selecting') {
    const matched = sumSelected() === game.rollTotal && game.selected.size > 0;
    const close = document.createElement('button');
    close.className = 'btn btn-primary';
    close.type = 'button';
    close.id = 'btn-close-tiles';
    close.textContent = 'Close tiles';
    close.disabled = !matched;
    close.addEventListener('click', confirmClose);
    c.appendChild(close);
  }
}

let tooltipShownOnce = false;
function showTooltipOnce() {
  if (tooltipShownOnce) return;
  tooltipShownOnce = true;
  const tip = document.getElementById('tooltip');
  if (!tip) return;
  tip.classList.remove('hidden');
  document.getElementById('btn-die-info')?.setAttribute('aria-expanded', 'true');
  setTimeout(() => {
    tip.classList.add('hidden');
    document.getElementById('btn-die-info')?.setAttribute('aria-expanded', 'false');
  }, 5200);
}

function toggleTooltip() {
  const tip = document.getElementById('tooltip');
  if (!tip) return;
  const showing = !tip.classList.contains('hidden');
  tip.classList.toggle('hidden', showing);
  document.getElementById('btn-die-info')?.setAttribute('aria-expanded', String(!showing));
}

// ---------- Turn flow ----------
let rolling = false;
function doRoll(single) {
  if (rolling || game.phase !== 'idle') return;
  rolling = true;
  el('controls').innerHTML = '';
  setStatus('Rolling…');
  const pair = game.stream[game.rollIndex] || [1, 1];
  game.rollIndex++;
  game.rolls++;
  let ticks = 0;
  const anim = setInterval(() => {
    game.dice = single
      ? [1 + Math.floor(Math.random() * 6)]
      : [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    renderDice(true);
    if (++ticks > 40) clearInterval(anim);
  }, 70);
  setTimeout(() => {
    clearInterval(anim);
    game.dice = single ? [pair[0]] : [pair[0], pair[1]];
    game.rollTotal = game.dice.reduce((a, b) => a + b, 0);
    renderDice(false);
    rolling = false;
    afterRoll();
  }, 750);
}

function afterRoll() {
  const vals = openValues();
  if (hasCombo(vals, game.rollTotal)) {
    game.phase = 'selecting';
    game.selected = new Set();
    setStatus('Rolled <b style="margin:0 4px">' + game.rollTotal + '</b> · pick tiles');
    el('hint').textContent = 'Tap tiles that add up to ' + game.rollTotal + '.';
    renderTiles();
    renderControls();
  } else {
    setStatus('No tiles make ' + game.rollTotal, 'warn');
    el('hint').textContent = 'No combination left. Turn over.';
    game.phase = 'ended';
    setTimeout(endTurn, 1400);
  }
}

function toggleTile(v) {
  if (game.phase !== 'selecting') return;
  if (game.selected.has(v)) game.selected.delete(v);
  else game.selected.add(v);
  const s = sumSelected();
  if (s > game.rollTotal) {
    const node = document.querySelector('.tile[data-value="' + v + '"]');
    if (node) {
      node.classList.add('shake');
      setTimeout(() => node.classList.remove('shake'), 400);
    }
  }
  const matched = s === game.rollTotal && game.selected.size > 0;
  if (matched) setStatus('Selected ' + s + ' / ' + game.rollTotal + ' ✓', 'match');
  else if (s > game.rollTotal) setStatus('Selected ' + s + ' <span class="need">/ ' + game.rollTotal + ' · too high</span>', 'warn');
  else setStatus('Selected ' + s + ' <span class="need">/ ' + game.rollTotal + '</span>');
  renderTiles();
  renderControls();
}

function confirmClose() {
  if (sumSelected() !== game.rollTotal || game.selected.size === 0) return;
  game.selected.forEach(v => {
    game.tiles.find(t => t.value === v).open = false;
  });
  game.selected = new Set();
  game.cleanCur++;
  game.cleanBest = Math.max(game.cleanBest, game.cleanCur);
  renderTiles();
  if (openValues().length === 0) {
    game.phase = 'ended';
    setStatus('Shut the Box!', 'match');
    setTimeout(endTurn, 600);
    return;
  }
  game.phase = 'idle';
  game.dice = [];
  renderDice(false);
  setStatus('Roll again');
  renderControls();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function endTurn() {
  const remaining = openValues();
  const isPerfect = remaining.length === 0;
  const isAlmost = remaining.length === 1;
  const score = scoreOf(remaining);

  const result = {
    mode: game.mode,
    seed: game.seed,
    day: game.day,
    score,
    rolls: game.rolls,
    streak: game.cleanBest,
    mask: maskFromClosed(game.tiles.map(t => !t.open)),
    perfect: isPerfect,
  };

  if (game.mode === 'daily') saveDailyResult(game.seed, result);
  lastResult = result;

  el('controls').innerHTML = '';
  el('hint').textContent = '';
  const tileNodes = [...document.querySelectorAll('#tiles .tile')];

  if (isPerfect) {
    setStatus('Shut the Box!', 'match');
    for (const n of tileNodes) { n.classList.add('perfect-pulse'); await sleep(80); }
    await sleep(450);
    burstConfetti();
    await sleep(650);
  } else {
    for (const n of tileNodes) {
      if (n.classList.contains('closed')) { n.classList.add('settle'); await sleep(100); }
    }
    await sleep(250);
    if (isAlmost) {
      const lone = tileNodes.find(n => !n.classList.contains('closed'));
      if (lone) lone.classList.add('alone');
      setStatus('So close…', 'warn');
      await sleep(1500);
    } else {
      await sleep(350);
    }
  }

  if (game.mode === 'challenge' && challengeIncoming) {
    showComparison(challengeIncoming, result);
  } else {
    showResult(result);
  }
}

// ---------- Spoiler-free share surfaces ----------
function verdictOf(score) {
  return score === 0 ? 'Shut the Box' : score + ' open';
}

function shareTextFor(result) {
  const label = result.mode === 'daily' || result.day
    ? 'Shut the Box · Day ' + result.day
    : 'Shut the Box · Friendly round';
  const flame = streakLine(loadHistory(), TODAY);
  if (result.perfect) return label + '\nShut the Box! Every tile down. Can you do the same?' + flame;
  return label + '\n' + verdictOf(result.score) + ' — lower is better. Can you beat it?' + flame;
}

function streakLine(history, today) {
  const s = computeStreak(history, today);
  return s >= 2 ? '\n🔥 ' + s + '-day streak' : '';
}

function renderScoreTile(eyebrowId, scoreId, verdictId, streakId, result, history) {
  el(eyebrowId).textContent = result.day ? 'Day ' + result.day : 'Friendly round';
  el(scoreId).innerHTML = result.perfect ? '<span class="shut-word">SHUT</span>' : String(result.score);
  const verdict = el(verdictId);
  verdict.textContent = verdictOf(result.score);
  verdict.classList.toggle('gold', !!result.perfect);
  const s = computeStreak(history, TODAY);
  el(streakId).textContent = s >= 2 ? '🔥 ' + s + '-day streak' : '';
}

function showResult(r) {
  el('result-day').textContent = r.mode === 'daily' ? 'Daily Challenge · Day ' + r.day
    : r.mode === 'challenge' ? 'Challenge Round' : 'Casual Round';
  const hl = el('result-headline');
  if (r.perfect) {
    hl.textContent = 'Shut the Box!';
    hl.className = 'result-headline perfect';
    el('result-sub').textContent = 'A perfect game. Every tile down. This almost never happens.';
  } else if (r.score <= 12) {
    hl.textContent = 'Sharp game';
    hl.className = 'result-headline almost';
    el('result-sub').innerHTML = 'Just <b>' + r.score + '</b> left open. Lower is better.';
  } else {
    hl.textContent = 'Score ' + r.score;
    hl.className = 'result-headline';
    el('result-sub').innerHTML = '<b>' + r.score + '</b> still open. Lower is better' + (r.mode === 'daily' ? ' — come back tomorrow.' : '. Keep rolling.');
  }
  renderScoreTile('st-eyebrow', 'st-score', 'st-verdict', 'st-streak', r, loadHistory());

  // Action set depends on mode; every result carries the friend-challenge CTA.
  const again = el('btn-again');
  again.style.display = r.mode === 'daily' ? 'none' : '';
  again.textContent = r.mode === 'challenge' ? 'Play Casual Instead' : 'Play Again';
  el('btn-challenge').style.display = r.mode === 'challenge' ? 'none' : '';
  showScreen('result');
}

// ---------- Sharing ----------
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      return true;
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
}

async function shareOrCopy(title, text, url) {
  const payload = { title, text };
  if (url) payload.url = url;
  if (navigator.share) {
    try {
      await navigator.share(payload);
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return true; // user closed the sheet
      console.warn('navigator.share failed, falling back to copy:', err);
    }
  }
  const full = text + (url ? '\n' + url : '');
  const ok = await copyText(full);
  toast(ok ? 'Copied to clipboard' : 'Copy failed — long-press to copy');
  return ok;
}

el('btn-share').addEventListener('click', () => {
  if (!lastResult) return;
  shareOrCopy('Shut the Box', shareTextFor(lastResult), siteUrl());
});

function siteUrl() {
  return location.origin + location.pathname;
}

// ---------- Challenge: sender ----------
let challengeSource = null; // result being challenged with

function openChallengeIntro(source) {
  challengeSource = source;
  el('challenge-from-summary').innerHTML = source
    ? ('You’ll challenge with: <b>' + (source.perfect ? 'Shut the Box!' : verdictOf(source.score)) + '</b> on ' + (source.day ? 'Day ' + source.day : 'a friendly round') + '.')
    : '';
  el('sender-name').value = loadName();
  showScreen('challenge');
}

el('btn-challenge').addEventListener('click', () => {
  if (lastResult) openChallengeIntro(lastResult);
});
el('btn-challenge-home').addEventListener('click', () => {
  const played = loadHistory()[TODAY];
  if (played) openChallengeIntro({ ...played, mode: 'daily', day: DAY });
  else openChallengeIntro(null);
});
el('btn-challenge-play').addEventListener('click', () => {
  startGame('casual', 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1e9), 0);
});
el('btn-send-challenge').addEventListener('click', () => {
  if (!challengeSource) return;
  const name = el('sender-name').value.trim();
  saveName(name);
  const url = buildChallengeUrl(siteUrl(), {
    seed: challengeSource.seed,
    day: challengeSource.day || 0,
    score: challengeSource.score,
    rolls: challengeSource.rolls,
    streak: challengeSource.streak,
    mask: challengeSource.mask,
    name,
  });
  const label = challengeSource.day ? 'Day ' + challengeSource.day : 'a friendly round';
  const text = 'I went ' + (challengeSource.perfect ? 'Shut the Box!' : verdictOf(challengeSource.score)) +
    ' on Shut the Box · ' + label + '. Same dice, one shot — beat me:';
  shareOrCopy('Shut the Box — Challenge', text, url);
});

// ---------- Challenge: recipient ----------
el('btn-accept').addEventListener('click', () => {
  if (!challengeIncoming) return;
  // Keep challengeIncoming — endTurn hands it to showComparison when the round ends.
  clearChallengeParam();
  startGame('challenge', challengeIncoming.seed, challengeIncoming.day);
});
el('btn-decline').addEventListener('click', () => {
  challengeIncoming = null;
  clearChallengeParam();
  showScreen('home');
});

function clearChallengeParam() {
  try { history.replaceState(null, '', location.pathname); } catch { /* file:// or sandboxed */ }
}

function enterInviteFlow(ch) {
  challengeIncoming = ch;
  el('invite-name').textContent = ch.name ? ch.name + ' challenges you' : 'A friend challenges you';
  el('invite-eyebrow').textContent = ch.day ? 'Challenge · Day ' + ch.day : 'Challenge · Friendly round';
  el('invite-sub').innerHTML = ch.perfect
    ? 'They <b>shut the box</b> on this exact dice sequence. Your turn.'
    : 'They left <b>' + ch.score + ' open</b> on this exact dice sequence. Same dice, one shot.';
  renderScoreTile('invite-tile-eyebrow', 'invite-tile-score', 'invite-tile-verdict', 'invite-tile-streak',
    { score: ch.score, perfect: ch.score === 0, day: ch.day }, {}); // recipient's own streak does not belong on the sender's card
  showScreen('invite');
}

// ---------- Comparison (post-play — strips are the payoff) ----------
function miniStrip(containerId, mask) {
  const wrap = el(containerId);
  wrap.innerHTML = '';
  [...mask].forEach((bit, i) => {
    const t = document.createElement('span');
    t.className = 'mt' + (bit === '1' ? ' closed' : '');
    t.textContent = i + 1;
    wrap.appendChild(t);
  });
}

function showComparison(ch, mine) {
  el('cmp-eyebrow').textContent = ch.day ? 'Head to Head · Day ' + ch.day : 'Head to Head · Friendly round';
  el('cmp-who-them').textContent = ch.name || 'Friend';
  const iWon = mine.score < ch.score;
  const tie = mine.score === ch.score;
  el('cmp-headline').textContent = tie ? 'Dead heat!' : iWon ? 'You win!' : (ch.name || 'Friend') + ' wins!';
  el('cmp-headline').className = 'result-headline' + (iWon ? ' perfect' : tie ? '' : ' almost');
  el('cmp-sub').innerHTML = tie
    ? 'Same dice, same score. Settle it tomorrow.'
    : 'Same dice. <b>' + (iWon ? verdictOf(ch.score) + ' → your ' + verdictOf(mine.score) : 'your ' + verdictOf(mine.score) + ' → their ' + verdictOf(ch.score)) + '</b>.';

  miniStrip('cmp-strip-me', mine.mask);
  miniStrip('cmp-strip-them', ch.mask);

  const rows = [
    ['cmp-me-score', 'cmp-them-score', mine.score, ch.score, Math.min],
    ['cmp-me-rolls', 'cmp-them-rolls', mine.rolls, ch.rolls, Math.min],
    ['cmp-me-streak', 'cmp-them-streak', mine.streak, ch.streak, Math.max],
  ];
  for (const [meId, themId, mineVal, themVal, better] of rows) {
    const meEl = el(meId);
    const themEl = el(themId);
    meEl.textContent = mineVal;
    themEl.textContent = themVal;
    meEl.classList.toggle('win', mineVal !== themVal && better(mineVal, themVal) === mineVal);
    themEl.classList.toggle('win', mineVal !== themVal && better(themVal, mineVal) === themVal);
  }
  el('cmp-side-me').classList.toggle('winner', !tie && iWon);
  el('cmp-side-them').classList.toggle('winner', !tie && !iWon);

  el('btn-share-comparison').onclick = () => {
    const label = ch.day ? 'Day ' + ch.day : 'a friendly round';
    const text = 'Head-to-head on Shut the Box · ' + label + ': ' +
      verdictOf(mine.score) + ' vs ' + (ch.name || 'friend') + '’s ' + verdictOf(ch.score) + '. Same dice, different fates.';
    shareOrCopy('Shut the Box — Head to Head', text, siteUrl());
  };
  showScreen('compare');
}

el('btn-cmp-done').addEventListener('click', () => { challengeIncoming = null; renderHome(); showScreen('home'); });

// ---------- History screen ----------
function renderHistory() {
  const history = loadHistory();
  const streak = computeStreak(history, TODAY);
  const scores = Object.values(history);
  const best = scores.length ? Math.min(...scores.map(r => r.score)) : null;
  el('stat-streak').textContent = String(streak);
  el('stat-best').textContent = best === null ? '—' : String(best);
  el('stat-shuts').textContent = String(scores.filter(r => r.score === 0).length);

  // 12-week heatmap: columns are weeks (Mon–Sun), oldest → newest.
  const wrap = el('heatmap');
  wrap.innerHTML = '';
  const todayUtc = new Date(TODAY + 'T00:00:00Z');
  const dow = (todayUtc.getUTCDay() + 6) % 7; // Monday = 0
  const weekEnd = new Date(todayUtc.getTime() + (6 - dow) * 86400000); // this week's Sunday
  const start = new Date(weekEnd.getTime() - (12 * 7 - 1) * 86400000);
  for (let w = 0; w < 12; w++) {
    const col = document.createElement('div');
    col.className = 'heat-col';
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start.getTime() + (w * 7 + d) * 86400000);
      const ds = utcDateStr(dt);
      const cell = document.createElement('div');
      const r = history[ds];
      cell.className = 'heat-cell ' + (r ? heatBucket(r) : '');
      cell.title = ds + (r ? ' — ' + (r.score === 0 ? 'Shut the Box!' : r.score + ' open') : '');
      if (ds === TODAY) cell.style.outline = '2px solid rgba(31,77,61,.5)';
      col.appendChild(cell);
    }
    wrap.appendChild(col);
  }

  const list = el('day-list');
  list.innerHTML = '';
  const entries = Object.entries(history).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  if (!entries.length) {
    list.innerHTML = '<div class="empty-note">Play your first daily challenge and it will show up here.</div>';
  } else {
    for (const [ds, r] of entries) {
      const item = document.createElement('div');
      item.className = 'day-item';
      const dn = dayNumber(ds);
      item.innerHTML =
        '<div class="d-num">Day ' + dn + '</div>' +
        '<div class="d-date">' + formatDateShort(ds) + (r.rolls ? ' · ' + r.rolls + ' rolls' : '') + '</div>' +
        '<div class="d-score' + (r.score === 0 ? ' perfect' : '') + '">' + (r.score === 0 ? 'SHUT' : r.score) + '</div>';
      list.appendChild(item);
    }
  }
}

// ---------- Home ----------
function renderHome() {
  const history = loadHistory();
  const played = history[TODAY];
  const btnDaily = el('btn-daily');
  if (played) {
    btnDaily.textContent = 'See Today’s Result';
  } else {
    btnDaily.textContent = 'Play Today’s Challenge · Day ' + DAY;
  }
  const chip = el('home-streak');
  const s = computeStreak(history, TODAY);
  if (s >= 1) {
    chip.style.display = '';
    el('home-streak-text').textContent = s + '-day streak';
  } else {
    chip.style.display = 'none';
  }
}

// ---------- Navigation wiring ----------
el('btn-daily').addEventListener('click', () => {
  const played = loadHistory()[TODAY];
  if (played) {
    lastResult = { ...played, mode: 'daily', day: DAY };
    showResult(lastResult);
  } else {
    startGame('daily', TODAY, DAY);
  }
});
el('btn-casual').addEventListener('click', () => {
  startGame('casual', 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1e9), 0);
});
el('btn-how').addEventListener('click', () => showScreen('how'));
el('btn-history').addEventListener('click', () => { renderHistory(); showScreen('history'); });
el('btn-how-play').addEventListener('click', () => {
  const played = loadHistory()[TODAY];
  if (played) {
    lastResult = { ...played, mode: 'daily', day: DAY };
    showResult(lastResult);
  } else {
    startGame('daily', TODAY, DAY);
  }
});
el('btn-game-back').addEventListener('click', () => { rolling = false; renderHome(); showScreen('home'); });
el('btn-again').addEventListener('click', () => {
  startGame('casual', 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1e9), 0);
});
document.querySelectorAll('[data-nav="home"]').forEach(b =>
  b.addEventListener('click', () => { renderHome(); showScreen('home'); }));

// ---------- Entry point: challenge link, then home ----------
(function init() {
  renderHome();
  showScreen('home');
  const params = new URLSearchParams(location.search);
  const c = params.get('c');
  if (c) {
    const ch = decodeChallengeState(c);
    if (ch) {
      enterInviteFlow(ch);
      return;
    }
    toast('That challenge link looks broken');
  }
})();
