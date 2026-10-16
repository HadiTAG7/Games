/* global $, h, storage, act, state, app, field, joinCard, gamePicker, kickButton, endGame, confetti, HOST_GAMES,
   TEAM_ORDER, TEAM_INFO, otherTeam, teamLabel, roundsText, cardFace, preloadImages, preloadNote, clockMs, clocksEl, startClockTicker,
   spinRemaining, wheelEl, scoreboardEl, roundResultText, recapEl, timeRulesList */
'use strict';

// Host screens for «تحدي الوقت». The host is the judge: this screen shows
// the answer and the ✅ صح / ⏭️ تخطي buttons, with keyboard shortcuts.
(() => {
const SECONDS = [30, 45, 60, 90];
const ROUNDS = [1, 2, 3, 4, 5];
const PENALTIES = [[0, 'بدون خصم وقت'], [3, 'تخصم 3 ثواني'], [5, 'تخصم 5 ثواني']];
const PREFS_KEY = 'tc:host-prefs';

let prefs = { sound: true, answer: true, ...storage(PREFS_KEY) };
let busy = false;
let rerenderTimer = null;
let previous = null; // last state seen, to play sounds on changes

function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  storage(PREFS_KEY, prefs);
  render();
}

/** Sends one judge action at a time, so a double tap can't skip two pictures. */
async function send(event, payload) {
  if (busy) return;
  busy = true;
  try {
    await act(event, payload);
  } finally {
    busy = false;
  }
}

/* ---------- Sound ---------- */

let audio = null;
function beep(freq, ms, volume = 0.18) {
  if (!prefs.sound) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + ms / 1000);
  } catch {
    // No audio on this device; the game works without it.
  }
}

let lastBeep = { team: null, second: null };
function countdownBeeps(s) {
  if (s.phase !== 'playing' || s.round.paused) return;
  const { round } = s;
  const second = Math.ceil(clockMs(round, round.active) / 1000);
  if (second >= 1 && second <= 5 && (second !== lastBeep.second || round.active !== lastBeep.team)) beep(660, 90);
  lastBeep = { team: round.active, second };
}

function soundForChange(prev, next) {
  if (!prev || prev.gameType !== 'time' || !prev.round || !next.round) return;
  if (prev.phase === 'playing' && next.phase === 'roundOver' && next.round.result.reason === 'time') {
    beep(160, 900, 0.3);
    return;
  }
  if (prev.phase !== 'playing' || next.phase !== 'playing' || prev.round.spinId !== next.round.spinId) return;
  if (next.round.cardNumber > prev.round.cardNumber) {
    if (next.round.active !== prev.round.active) beep(990, 140);
    else beep(320, 140);
  }
}

startClockTicker(() => state, countdownBeeps);

/* ---------- Keyboard ---------- */

function shortcut(code) {
  const { phase, round } = state;
  if (phase === 'playing') {
    if (code === 'Space') return round.paused ? null : 'host:tc-correct';
    if (code === 'KeyS') return round.paused ? null : 'host:tc-skip';
    if (code === 'KeyP') return round.paused ? 'host:tc-resume' : 'host:tc-pause';
    if (code === 'KeyZ') return round.canUndo ? 'host:tc-undo' : null;
    return null;
  }
  if (phase === 'wheel' && code === 'Space') return 'host:tc-spin';
  if (phase === 'ready' && spinRemaining(round.spinId) === 0) {
    if (code === 'Space') return 'host:tc-go';
    if (code === 'KeyR') return 'host:tc-spin';
  }
  return null;
}

document.addEventListener('keydown', (e) => {
  if (!state || state.gameType !== 'time' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const event = shortcut(e.code);
  if (!event) return;
  e.preventDefault();
  send(event);
});

/* ---------- Shared bits ---------- */

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'تحدي الوقت ⏱️'),
    inGame && state.round ? h('div', { class: 'pill' }, `الجولة ${state.round.number}`) : null,
    inGame ? h('button', {
      class: 'pill pill-btn',
      title: prefs.sound ? 'كتم الصوت' : 'تشغيل الصوت',
      'aria-label': prefs.sound ? 'كتم الصوت' : 'تشغيل الصوت',
      onclick: () => savePrefs({ sound: !prefs.sound }),
    }, prefs.sound ? '🔊' : '🔇') : null,
    h('div', { class: 'pill' }, 'الغرفة ', h('b', {}, state.code)),
  );
}

function categoryTitle(category) {
  return h('div', { class: 'category-tag' }, `${category.emoji} ${category.name}`);
}

/* ---------- Lobby ---------- */

let pendingCategories = null;
let categoriesSeq = 0;

function currentCategories() {
  return pendingCategories ?? state.settings.categories;
}

// Taps apply locally right away, so quick taps build on each other even
// while older updates are still coming back from the server.
async function setCategories(categories) {
  pendingCategories = categories;
  const seq = ++categoriesSeq;
  updateLobby();
  await act('host:settings', { categories });
  if (seq === categoriesSeq) {
    pendingCategories = null;
    if (state.phase === 'lobby' && state.gameType === 'time') updateLobby();
  }
}

function toggleCategory(id) {
  const picked = new Set(currentCategories());
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  setCategories(state.categories.filter((c) => picked.has(c.id)).map((c) => c.id));
}

function renderLobby() {
  const s = state.settings;
  const select = (id, key, options, value) => h('select', {
    id,
    onchange: (e) => act('host:settings', { [key]: Number(e.target.value) }),
  }, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));

  const categories = h('div', { class: 'chips tc-categories', role: 'group', 'aria-label': 'الفئات' },
    state.categories.map((c) => h('button', {
      type: 'button',
      class: 'category-chip',
      'data-category': c.id,
      onclick: () => toggleCategory(c.id),
    }, h('span', {}, c.emoji), h('span', {}, c.name), h('small', { class: 'category-count' }, c.count))));

  return h('main', { class: 'lobby' },
    joinCard(),
    h('section', { class: 'card' },
      gamePicker(),
      h('div', { class: 'field-head tc-teams-head' },
        h('h2', {}, 'الفرق ', h('span', { id: 'player-count', class: 'count' })),
        h('button', { type: 'button', class: 'btn small', onclick: () => act('host:tc-shuffle') }, '🔀 وزّعهم عشوائي'),
      ),
      h('div', { class: 'tc-teams' }, TEAM_ORDER.map((team) => h('div', { class: `tc-team ${team}` },
        h('h3', {}, teamLabel(team), h('span', { class: 'count', 'data-team-count': team })),
        h('ul', { class: 'chips', 'data-team': team }),
      ))),
      h('p', { class: 'hint' }, 'اضغط على اسم أي لاعب عشان تنقله للفريق الثاني'),
      h('h2', {}, 'الإعدادات'),
      h('div', { class: 'settings' },
        field('وقت كل فريق', select('tc-seconds', 'seconds', SECONDS.map((n) => [n, `${n} ثانية`]), s.seconds)),
        field('يفوز باللعبة اللي يكسب', select('tc-rounds', 'roundsToWin', ROUNDS.map((n) => [n, roundsText(n)]), s.roundsToWin)),
        field('التخطي', select('tc-penalty', 'skipPenalty', PENALTIES, s.skipPenalty)),
        h('details', { class: 'field wide tc-cat-details' },
          h('summary', {}, 'الفئات اللي تختار منها العجلة: ', h('b', { id: 'tc-category-count' })),
          h('div', { class: 'field-head' },
            h('a', { class: 'inline-link', href: '/time-preview', target: '_blank', rel: 'noopener' }, '👀 شوف كل الصور وأجوبتها'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories(state.categories.map((c) => c.id)) }, 'الكل'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories([]) }, 'ولا وحدة'),
          ),
          categories,
        ),
      ),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: () => send('host:start') }, 'ابدأ اللعبة ⏱️'),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  for (const team of TEAM_ORDER) {
    const players = state.teams[team];
    const list = $(`[data-team="${team}"]`);
    list.replaceChildren(...players.map((p) => h('li', { class: `chip${p.connected ? '' : ' away'}` },
      h('button', {
        type: 'button',
        class: 'chip-btn',
        title: `انقل ${p.name} للفريق ${TEAM_INFO[otherTeam(team)].name}`,
        onclick: () => act('host:tc-team', { playerId: p.id, team: otherTeam(team) }),
      }, p.name),
      kickButton(p),
    )));
    if (!players.length) list.append(h('li', { class: 'empty' }, 'ما فيه أحد'));
    $(`[data-team-count="${team}"]`).textContent = players.length;
  }
  $('#player-count').textContent = state.players.length;

  const picked = new Set(currentCategories());
  document.querySelectorAll('.tc-categories .category-chip').forEach((el) => {
    const on = picked.has(el.dataset.category);
    el.classList.toggle('picked', on);
    el.setAttribute('aria-pressed', String(on));
  });
  $('#tc-category-count').textContent = picked.size === state.categories.length
    ? `كلها (${picked.size})`
    : `${picked.size} من ${state.categories.length}`;
  $('#rules-body').replaceChildren(timeRulesList(state.settings));

  const teamsReady = state.teams.red.length > 0 && state.teams.blue.length > 0;
  $('#start').disabled = !teamsReady || !picked.size;
  let hint = '';
  if (!state.players.length) hint = 'امسحوا الباركود وادخلوا، واللعبة تقسمكم فريقين';
  else if (!teamsReady) hint = 'كل فريق يحتاج لاعب واحد على الأقل';
  else if (!picked.size) hint = 'اختر فئة وحدة على الأقل';
  $('#start-hint').textContent = hint;
}

/* ---------- Wheel ---------- */

function renderWheel() {
  return h('main', { class: 'stage tc-stage' },
    scoreboardEl(state),
    h('div', { class: 'tc-big-emoji' }, '🎡'),
    h('h1', { class: 'center' }, `الجولة ${state.roundNumber + 1}`),
    h('p', { class: 'center' }, `${teamLabel(state.nextStartTeam)} يبدأ هالجولة`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big tc-main-btn', onclick: () => send('host:tc-spin') }, '🎡 دوّر العجلة'),
    ),
    h('p', { class: 'hint center kbd-hint' }, 'أو اضغط مسافة'),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة')),
  );
}

function renderReady() {
  const { round } = state;
  const left = spinRemaining(round.spinId);
  if (left > 0) {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => {
      if (state.gameType === 'time' && state.phase === 'ready' && state.round.spinId === round.spinId) render();
    }, left + 30);
  }
  return h('main', { class: 'stage tc-stage' },
    wheelEl(round),
    left > 0
      ? h('p', { class: 'tc-landed muted' }, 'العجلة تدور…')
      : h('div', { class: 'tc-landed' },
        h('div', { class: 'tc-landed-name' }, `${round.category.emoji} ${round.category.name}`),
        h('p', {}, `${teamLabel(round.startTeam)} يبدأ · ${state.settings.seconds} ثانية لكل فريق`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary big tc-main-btn', onclick: () => send('host:tc-go') }, 'ابدأ الوقت ⏱️'),
          h('button', { class: 'btn', onclick: () => send('host:tc-spin') }, '🎡 دوّر مرة ثانية'),
        ),
        h('p', { class: 'hint center kbd-hint' }, 'مسافة = ابدأ · R = دوّر مرة ثانية'),
      ),
    preloadNote(round.preload),
  );
}

/* ---------- Playing ---------- */

function renderPlaying() {
  const { round } = state;
  preloadImages(round.preload);
  const { card } = round;
  const penalty = state.settings.skipPenalty;
  const masked = !prefs.answer;
  return h('main', { class: `stage tc-stage tc-playing${round.paused ? ' paused' : ''}` },
    h('div', { class: 'tc-round-head' },
      categoryTitle(round.category),
      h('span', { class: 'pill' }, `صورة ${round.cardNumber}`, round.cardsLeft > 1 ? ` · باقي ${round.cardsLeft - 1}` : ' · الأخيرة'),
    ),
    clocksEl(round, { seconds: state.settings.seconds }),
    h('div', { class: 'tc-card' },
      cardFace(card, { brokenText: '😕 الصورة ما فتحت — اضغط «تخطي»' }),
      round.paused ? h('div', { class: 'tc-paused' }, '⏸️ الوقت موقّف') : null,
    ),
    h('button', {
      type: 'button',
      class: `tc-answer${masked ? ' masked' : ''}`,
      title: masked ? 'اضغط عشان تشوف الجواب' : 'اضغط عشان تخفي الجواب (لو الشاشة قدام الكل)',
      onclick: () => savePrefs({ answer: masked }),
    },
      h('small', {}, masked ? '🙈 الجواب مخفي — اضغط عشان تشوفه' : 'الجواب'),
      h('b', {}, card.answer),
      card.alt ? h('span', { class: 'tc-alt', dir: 'ltr' }, card.alt) : null,
    ),
    h('div', { class: 'tc-judge' },
      h('button', { class: 'btn tc-correct', disabled: round.paused, onclick: () => send('host:tc-correct') }, '✅ صح'),
      h('button', { class: 'btn tc-skip', disabled: round.paused, onclick: () => send('host:tc-skip') },
        '⏭️ تخطي', penalty ? h('small', {}, `−${penalty} ث`) : null),
    ),
    h('div', { class: 'actions tc-tools' },
      round.paused
        ? h('button', { class: 'btn primary', onclick: () => send('host:tc-resume') }, '▶️ كمّل')
        : h('button', { class: 'btn', onclick: () => send('host:tc-pause') }, '⏸️ إيقاف'),
      h('button', { class: 'btn', disabled: !round.canUndo, onclick: () => send('host:tc-undo') }, '↩︎ تراجع'),
      h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
    h('p', { class: 'hint center kbd-hint' }, 'الكيبورد: مسافة = صح · S = تخطي · P = إيقاف · Z = تراجع'),
  );
}

/* ---------- Round over and final ---------- */

function renderRoundOver() {
  const { round } = state;
  const text = roundResultText(round.result);
  const last = Boolean(state.matchWinner);
  return h('main', { class: 'stage tc-stage' },
    h('div', { class: `verdict tc-verdict ${round.result.winner ?? 'draw'}` },
      text.title, h('div', { class: 'verdict-note' }, text.detail)),
    scoreboardEl(state),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big tc-main-btn', onclick: () => send('host:next') },
        last ? 'النتيجة النهائية 🏆' : 'الجولة الجاية 🎡'),
      last ? null : h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
    h('h2', { class: 'tc-recap-title' }, `صور الجولة · ${round.category.emoji} ${round.category.name}`),
    recapEl(round.recap),
  );
}

function renderFinal() {
  const winner = state.matchWinner;
  return h('main', { class: 'stage narrow final' },
    winner ? confetti() : null,
    h('div', { class: 'trophy' }, winner ? '🏆' : '🤝'),
    h('h1', { class: 'winner-name' }, winner ? `${teamLabel(winner)} فاز!` : 'تعادل!'),
    winner && state.teams[winner].length
      ? h('p', { class: 'center' }, state.teams[winner].map((p) => p.name).join(' · '))
      : null,
    scoreboardEl(state),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => act('host:restart') }, 'لعبة جديدة 🔁'),
    ),
    h('p', { class: 'hint center' }, 'تقدرون تغيّرون الفرق أو تختارون لعبة ثانية من اللوبي'),
  );
}

/* ---------- Render ---------- */

const SCREENS = {
  lobby: renderLobby,
  wheel: renderWheel,
  ready: renderReady,
  playing: renderPlaying,
  roundOver: renderRoundOver,
  final: renderFinal,
};

/** Everything a screen shows, so updates that change nothing (a phone reconnecting) don't redraw. */
function screenKey() {
  const { round } = state;
  return JSON.stringify([
    state.phase, state.score, state.matchWinner, state.nextStartTeam, state.roundNumber, prefs,
    round && { ...round, preload: round.preload?.length ?? 0 },
    state.phase === 'ready' && spinRemaining(round.spinId) === 0,
    state.phase === 'final' && state.teams,
  ]);
}

function render() {
  soundForChange(previous, state);
  previous = state;
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  const key = screenKey();
  if ($('#tc-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'tc-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

HOST_GAMES.time = { render, updateLobby };
})();
