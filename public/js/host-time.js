/* global $, h, storage, act, state, app, field, joinCard, gamePicker, endGame, confetti, HOST_GAMES, teamsSection, updateTeamsSection,
   TEAM_ORDER, teamLabel, roundsText, cardFace, preloadImages, preloadNote, clockMs, clocksEl, startClockTicker,
   spinRemaining, SPIN_MS, sfx, wheelEl, scoreboardEl, roundResultText, recapEl, timeRulesList, banksBox, TEAM_INFO, duelEl */
'use strict';

// Host screens for «تحدي الوقت». The host is the judge: this screen shows
// the answer and the ✅ صح / ⏭️ تخطي buttons, with keyboard shortcuts.
(() => {
const SECONDS = [30, 45, 60, 90];
const ROUNDS = [1, 2, 3, 4, 5];
const PENALTIES = [[0, 'بدون خصم وقت'], [3, 'تخصم 3 ثواني'], [5, 'تخصم 5 ثواني']];
const PREFS_KEY = 'tc:host-prefs';
const EXCLUDED_KEY = 'tc:excluded'; // pictures this device took out; the preview page lists them

let prefs = { answer: true, ...storage(PREFS_KEY) };
let busy = false;
let rerenderTimer = null;

function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  storage(PREFS_KEY, prefs);
  render();
}

/** Judge buttons say which screen they were pressed on, so the server ignores a double tap. */
function judge(event) {
  act(event, { step: state.round.step });
}

const excludedCards = () => storage(EXCLUDED_KEY) ?? [];

/** Takes the picture on screen out of the game, now and in later games on this device. */
function excludeCard() {
  const { round } = state;
  const key = `${round.category.id}:${round.card.answer}`;
  const saved = excludedCards();
  if (!saved.includes(key)) storage(EXCLUDED_KEY, [...saved, key]);
  judge('host:tc-exclude');
}

/** Other buttons send one action at a time, so a double tap can't spin twice. */
async function send(event, payload) {
  if (busy) return;
  busy = true;
  // Don't stay locked if a reply gets lost on a bad connection.
  const release = setTimeout(() => { busy = false; }, 3000);
  try {
    await act(event, payload);
  } finally {
    clearTimeout(release);
    busy = false;
  }
}

/* ---------- Sound ---------- */

let lastTick = null;
let lastSpin = null;
/** The running clock ticks every second, twice a second near the end; the wheel clicks as it turns. */
function tickSounds(s) {
  const { round } = s;
  if (s.phase === 'ready' && round.spinId) {
    const left = spinRemaining(round.spinId);
    const turned = 1 - (1 - (1 - left / SPIN_MS)) ** 3;
    const click = left > 0 ? Math.floor(turned * 34) : -1;
    if (click !== lastSpin) {
      if (click >= 0) sfx.play('spin');
      else if (lastSpin !== null) sfx.play('reveal');
      lastSpin = click;
    }
  } else {
    lastSpin = null;
  }
  if (s.phase !== 'playing' || round.paused) {
    lastTick = null;
    return;
  }
  const ms = clockMs(round, round.active);
  if (ms <= 0) return;
  const urgent = ms <= 5000;
  const mark = `${round.active}:${urgent}:${Math.ceil(ms / (urgent ? 500 : 1000))}`;
  if (mark === lastTick) return;
  lastTick = mark;
  sfx.play(urgent ? 'urgent' : Math.ceil(ms / 1000) % 2 ? 'tick' : 'tock');
}

function sounds(prev, next) {
  if (!prev.round || !next.round) return;
  if (prev.phase === 'playing' && next.phase === 'roundOver') {
    sfx.play(next.round.result.reason === 'time' ? 'timeUp' : 'win');
    return;
  }
  if (prev.phase !== 'playing' || next.phase !== 'playing' || prev.round.spinId !== next.round.spinId) return;
  if (next.round.cardNumber > prev.round.cardNumber) sfx.play(next.round.active !== prev.round.active ? 'correct' : 'skip');
}

startClockTicker(() => state, tickSounds);

/* ---------- Keyboard ---------- */

function shortcut(code) {
  const { phase, round } = state;
  if (phase === 'playing') {
    if (code === 'Space') return round.paused ? null : 'host:tc-correct';
    if (code === 'KeyS') return round.paused ? null : 'host:tc-skip';
    if (code === 'KeyP') return round.paused ? 'host:tc-resume' : 'host:tc-pause';
    if (code === 'KeyZ') return round.canUndo ? 'host:tc-undo' : null;
    if (code === 'KeyX') return 'host:tc-exclude';
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
  if (event === 'host:tc-exclude') excludeCard();
  else if (state.phase === 'playing') judge(event);
  else send(event);
});

/* ---------- Shared bits ---------- */

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'تحدي الوقت ⏱️'),
    inGame && state.round ? h('div', { class: 'pill' }, `الجولة ${state.round.number}`) : null,
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
      teamsSection(),
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
          excludedCards().length
            ? h('p', { class: 'hint' }, `🚫 استبعدت ${excludedCards().length} صورة من هالجهاز، وما راح تطلع. `,
              h('a', { class: 'inline-link', href: '/time-preview#excluded', target: '_blank', rel: 'noopener' }, 'شوفها'))
            : null,
        ),
      ),
      banksBox(),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: () => send('host:start', { excluded: excludedCards() }) }, 'ابدأ اللعبة ⏱️'),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  updateTeamsSection();

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

/** This round's two players; until the clock starts the host can swap either for a teammate. */
function duelPicker() {
  const { duel } = state;
  if (!duel) return null;
  const side = (team) => {
    const members = state.teams[team];
    return h('label', { class: `tc-duel-side ${team}` },
      h('small', {}, `${TEAM_INFO[team].emoji} ${TEAM_INFO[team].name}${members.length > 1 ? ' · اضغط وغيّره' : ''}`),
      members.length > 1
        ? h('select', {
          'aria-label': `لاعب ${teamLabel(team)}`,
          onchange: (e) => send('host:tc-player', { team, playerId: e.target.value }),
        }, members.map((p) => h('option', { value: p.id, selected: p.id === duel[team]?.id }, p.name)))
        : h('b', {}, duel[team]?.name ?? '—'));
  };
  return h('div', { class: 'tc-duel' }, side('red'), h('span', { class: 'tc-duel-vs' }, 'ضد'), side('blue'));
}

/** «أبو فهد يبدأ» */
const starterName = (team) => state.duel?.[team]?.name ?? teamLabel(team);

function renderWheel() {
  return h('main', { class: 'stage tc-stage' },
    scoreboardEl(state),
    h('div', { class: 'tc-big-emoji' }, '🎡'),
    h('h1', { class: 'center' }, `الجولة ${state.roundNumber + 1}: شخص ضد شخص`),
    duelPicker(),
    h('p', { class: 'center' }, `${starterName(state.nextStartTeam)} يبدأ هالجولة`),
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
    duelPicker(),
    wheelEl(round),
    left > 0
      ? h('p', { class: 'tc-landed muted' }, 'العجلة تدور…')
      : h('div', { class: 'tc-landed' },
        h('div', { class: 'tc-landed-name' }, `${round.category.emoji} ${round.category.name}`),
        h('p', {}, `${starterName(round.startTeam)} يبدأ · ${state.settings.seconds} ثانية لكل واحد`),
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
    clocksEl(round, { seconds: state.settings.seconds, duel: state.duel }),
    h('div', { class: 'tc-card' },
      cardFace(card, { brokenText: '😕 الصورة ما فتحت — اضغط «🚫 استبعد»' }),
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
      h('button', { class: 'btn tc-correct', disabled: round.paused, onclick: () => judge('host:tc-correct') }, '✅ صح'),
      h('button', { class: 'btn tc-skip', disabled: round.paused, onclick: () => judge('host:tc-skip') },
        '⏭️ تخطي', penalty ? h('small', {}, `−${penalty} ث`) : null),
    ),
    h('div', { class: 'actions tc-tools' },
      round.paused
        ? h('button', { class: 'btn primary', onclick: () => judge('host:tc-resume') }, '▶️ كمّل')
        : h('button', { class: 'btn', onclick: () => judge('host:tc-pause') }, '⏸️ إيقاف'),
      h('button', { class: 'btn', disabled: !round.canUndo, onclick: () => judge('host:tc-undo') }, '↩︎ تراجع'),
      h('button', {
        class: 'btn',
        title: 'صورة غلط أو تفضح الجواب؟ تتبدل بدون ما ينخصم وقت، وما تطلع لك مرة ثانية',
        onclick: excludeCard,
      }, '🚫 استبعد الصورة'),
      h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
    h('p', { class: 'hint center kbd-hint' }, 'الكيبورد: مسافة = صح · S = تخطي · P = إيقاف · Z = تراجع · X = استبعد'),
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
    duelEl(state.duel),
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
    state.phase, state.score, state.matchWinner, state.nextStartTeam, state.roundNumber, prefs, state.duel,
    ['wheel', 'ready'].includes(state.phase) && state.teams,
    round && { ...round, preload: round.preload?.length ?? 0 },
    state.phase === 'ready' && spinRemaining(round.spinId) === 0,
    state.phase === 'final' && state.teams,
  ]);
}

function render() {
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

HOST_GAMES.time = { render, updateLobby, sounds };
})();
