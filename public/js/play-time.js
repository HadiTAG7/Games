/* global $, h, app, state, screenKey: writable, confetti, PLAY_GAMES, TEAM_ORDER, otherTeam, teamLabel, cardFace,
   preloadImages, preloadNote, clocksEl, startClockTicker, spinRemaining, wheelEl, scoreboardEl, roundResultText,
   recapEl, timeRulesList, sfx, duelEl, icon */
'use strict';

// Player screens for «تحدي الوقت»: who plays this round, the picture and
// both clocks. Phones never get the answer while a round runs; it shows up
// in the round recap.
(() => {
let rerenderTimer = null;

startClockTicker(() => state);

const myTeam = () => state.me.team;
/** The player of a team this round. */
const duelist = (team) => state.duel?.[team] ?? null;
const iPlay = () => duelist(myTeam())?.id === state.me.id;

/** Who plays this round, and what that means for me. */
function duelBox() {
  const team = myTeam();
  let note = null;
  if (iPlay()) note = h('p', { class: 'tc-duel-note mine' }, 'أنت تلعب هالجولة! استعد');
  else if (team && duelist(team)) note = h('p', { class: 'tc-duel-note' }, `يلعب عن فريقكم: ${duelist(team).name} · لا تساعدونه `, icon('venetian-mask'));
  return [duelEl(state.duel, { meId: state.me.id }), note];
}

function topbar() {
  const team = myTeam();
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'تحدي الوقت ', icon('timer')),
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
    h('div', { class: 'wave' }, icon('hand')),
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
    h('div', { class: 'tc-big-emoji spin' }, icon('ferris-wheel')),
    h('h2', { class: 'center' }, 'المضيف بيدوّر العجلة…'),
    ...duelBox(),
    h('p', { class: 'center' }, `${duelist(state.nextStartTeam)?.name ?? teamLabel(state.nextStartTeam)} يبدأ هالجولة`),
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
  const starter = duelist(round.startTeam);
  const mine = starter?.id === state.me.id;
  return h('main', { class: 'stage narrow' },
    h('h2', { class: 'center' }, `الجولة ${round.number}`),
    ...duelBox(),
    wheelEl(round),
    left > 0
      ? h('p', { class: 'tc-landed muted' }, 'العجلة تدور…')
      : h('div', { class: 'tc-landed' },
        h('div', { class: 'tc-landed-name' }, `${round.category.name}`),
        h('p', {}, mine ? 'أنت تبدأ! استعد' : `${starter?.name ?? teamLabel(round.startTeam)} يبدأ`),
      ),
    preloadNote(round.preload),
  );
}

function renderPlaying() {
  const { round } = state;
  preloadImages(round.preload);
  const player = duelist(round.active);
  const mine = player?.id === state.me.id;
  let turn = `دور ${player?.name ?? teamLabel(round.active)}`;
  if (mine) turn = 'دورك! قل الجواب بصوت عالي';
  else if (round.active === myTeam()) turn = `دور ${player?.name ?? 'فريقكم'} من فريقكم · لا تساعدونه`;
  return h('main', { class: `stage narrow tc-playing${round.paused ? ' paused' : ''}` },
    round.paused
      ? h('div', { class: 'tc-turn' }, icon('pause'), ' المضيف وقّف الوقت')
      : h('div', { class: `tc-turn ${round.active}${mine ? ' mine' : ''}` }, turn),
    clocksEl(round, { seconds: state.settings.seconds, myTeam: myTeam(), duel: state.duel }),
    h('div', { class: 'category-tag' }, `${round.category.name}`),
    h('div', { class: 'tc-card' },
      cardFace(round.card, { brokenText: 'الصورة ما فتحت، المضيف بيتخطاها' }),
      round.paused ? h('div', { class: 'tc-paused' }, icon('pause')) : null,
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
    title = kind === 'good' ? 'فريقكم فاز بالجولة!' : 'فريقكم خسر الجولة';
  }
  return h('main', { class: 'stage narrow' },
    h('div', { class: `verdict ${kind}` }, title, h('div', { class: 'verdict-note' }, text.detail)),
    duelEl(state.duel, { meId: state.me.id }),
    scoreboardEl(state),
    h('p', { class: 'hint center' }, state.matchWinner ? 'انتظر النتيجة النهائية…' : 'انتظر الجولة الجاية…'),
    h('h2', { class: 'tc-recap-title' }, `صور الجولة · ${round.category.name}`),
    recapEl(round.recap),
  );
}

function renderFinal() {
  const winner = state.matchWinner;
  const won = winner && winner === myTeam();
  let title = 'تعادل!';
  if (winner) title = won ? 'فريقكم فاز!' : `فاز ${teamLabel(winner)}`;
  return h('main', { class: 'stage narrow final' },
    won ? confetti() : null,
    h('div', { class: 'trophy' }, won ? icon('trophy') : winner ? icon('gamepad-2') : icon('handshake')),
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
    state.phase, state.me, state.score, state.matchWinner, state.nextStartTeam, state.settings, state.duel,
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

/** A chime when your clock starts (you're playing this round). */
function sounds(prev, next) {
  if (next.phase !== 'playing' || !next.round || next.duel?.[next.round.active]?.id !== next.me.id) return;
  if (prev.phase !== 'playing' || prev.round?.active !== next.round.active) sfx.play('turn');
}

PLAY_GAMES.time = { render, sounds };
})();
