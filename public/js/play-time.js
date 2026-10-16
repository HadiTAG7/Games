/* global $, h, app, state, screenKey: writable, confetti, PLAY_GAMES, TEAM_ORDER, otherTeam, teamLabel, cardFace,
   preloadImages, preloadNote, clocksEl, startClockTicker, spinRemaining, wheelEl, scoreboardEl, roundResultText,
   recapEl, timeRulesList, sfx */
'use strict';

// Player screens for «تحدي الوقت»: the picture and both clocks. Phones never
// get the answer while a round runs; it shows up in the round recap.
(() => {
let rerenderTimer = null;

startClockTicker(() => state);

const myTeam = () => state.me.team;

function topbar() {
  const team = myTeam();
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'تحدي الوقت ⏱️'),
    team ? h('div', { class: `pill team-pill ${team}` }, teamLabel(team)) : null,
    h('div', { class: 'pill' }, state.me.name),
  );
}

function teamCard() {
  const team = myTeam();
  if (!team) return null;
  const mates = state.teams[team].filter((p) => p.id !== state.me.id).map((p) => p.name);
  return h('div', { class: `tc-myteam ${team}` },
    h('small', {}, 'فريقك'),
    h('b', {}, teamLabel(team)),
    mates.length ? h('div', { class: 'tc-mates' }, 'معك: ', mates.join(' · ')) : h('div', { class: 'tc-mates' }, 'لسا ما أحد معك'),
  );
}

function renderLobby() {
  const team = myTeam();
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, '👋'),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    teamCard(),
    team ? h('p', { class: 'muted center' }, `${teamLabel(otherTeam(team))}: `,
      state.teams[otherTeam(team)].map((p) => p.name).join(' · ') || 'ما فيه أحد للحين') : null,
    h('p', { class: 'muted center' }, 'انتظر المضيف يبدأ اللعبة…'),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), timeRulesList(state.settings)),
  );
}

function renderWheel() {
  return h('main', { class: 'stage narrow' },
    scoreboardEl(state),
    h('div', { class: 'tc-big-emoji spin' }, '🎡'),
    h('h2', { class: 'center' }, 'المضيف بيدوّر العجلة…'),
    h('p', { class: 'center' }, `${teamLabel(state.nextStartTeam)} يبدأ هالجولة`),
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
  const mine = round.startTeam === myTeam();
  return h('main', { class: 'stage narrow' },
    h('h2', { class: 'center' }, `الجولة ${round.number}`),
    wheelEl(round),
    left > 0
      ? h('p', { class: 'tc-landed muted' }, 'العجلة تدور…')
      : h('div', { class: 'tc-landed' },
        h('div', { class: 'tc-landed-name' }, `${round.category.emoji} ${round.category.name}`),
        h('p', {}, mine ? 'فريقكم يبدأ! استعدوا 🔥' : `${teamLabel(round.startTeam)} يبدأ`),
      ),
    preloadNote(round.preload),
  );
}

function renderPlaying() {
  const { round } = state;
  preloadImages(round.preload);
  const mine = round.active === myTeam();
  return h('main', { class: `stage narrow tc-playing${round.paused ? ' paused' : ''}` },
    round.paused
      ? h('div', { class: 'tc-turn' }, '⏸️ المضيف وقّف الوقت')
      : h('div', { class: `tc-turn ${round.active}${mine ? ' mine' : ''}` },
        mine ? 'دوركم! 🔥 قولوا الجواب بصوت عالي' : `دور ${teamLabel(round.active)} ⏳`),
    clocksEl(round, { seconds: state.settings.seconds, myTeam: myTeam() }),
    h('div', { class: 'category-tag' }, `${round.category.emoji} ${round.category.name}`),
    h('div', { class: 'tc-card' },
      cardFace(round.card, { brokenText: '😕 الصورة ما فتحت، المضيف بيتخطاها' }),
      round.paused ? h('div', { class: 'tc-paused' }, '⏸️') : null,
    ),
    h('p', { class: 'hint center' }, `صورة ${round.cardNumber}`),
  );
}

function renderRoundOver() {
  const { round } = state;
  const { winner } = round.result;
  const text = roundResultText(round.result);
  let kind = 'draw';
  let title = text.title;
  if (winner && myTeam()) {
    kind = winner === myTeam() ? 'good' : 'bad';
    title = kind === 'good' ? 'فريقكم فاز بالجولة! 🎉' : 'فريقكم خسر الجولة 😬';
  }
  return h('main', { class: 'stage narrow' },
    h('div', { class: `verdict ${kind}` }, title, h('div', { class: 'verdict-note' }, text.detail)),
    scoreboardEl(state),
    h('p', { class: 'hint center' }, state.matchWinner ? 'انتظر النتيجة النهائية…' : 'انتظر الجولة الجاية…'),
    h('h2', { class: 'tc-recap-title' }, `صور الجولة · ${round.category.emoji} ${round.category.name}`),
    recapEl(round.recap),
  );
}

function renderFinal() {
  const winner = state.matchWinner;
  const won = winner && winner === myTeam();
  let title = 'تعادل! 🤝';
  if (winner) title = won ? 'فريقكم فاز! 🏆' : `فاز ${teamLabel(winner)}`;
  return h('main', { class: 'stage narrow final' },
    won ? confetti() : null,
    h('div', { class: 'trophy' }, won ? '🏆' : winner ? '🎮' : '🤝'),
    h('h1', { class: 'center' }, title),
    scoreboardEl(state),
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

const SCREENS = {
  lobby: renderLobby,
  wheel: renderWheel,
  ready: renderReady,
  playing: renderPlaying,
  roundOver: renderRoundOver,
  final: renderFinal,
};

/** Everything a screen shows, so updates that change nothing don't redraw (and reload the picture). */
function key() {
  const { round } = state;
  return JSON.stringify([
    state.phase, state.me, state.score, state.matchWinner, state.nextStartTeam, state.settings,
    ['lobby', 'final'].includes(state.phase) && state.teams,
    round && { ...round, preload: round.preload?.length ?? 0 },
    state.phase === 'ready' && spinRemaining(round.spinId) === 0,
  ]);
}

function render() {
  screenKey = 'time';
  const k = key();
  if ($('#tc-root')?.dataset.key === k) return;
  const main = SCREENS[state.phase]();
  main.id = 'tc-root';
  main.dataset.key = k;
  app.replaceChildren(topbar(), main);
}

/** A chime when your team's clock starts. */
function sounds(prev, next) {
  if (next.phase !== 'playing' || !next.round || next.round.active !== next.me.team) return;
  if (prev.phase !== 'playing' || prev.round?.active !== next.round.active) sfx.play('turn');
}

PLAY_GAMES.time = { render, sounds };
})();
