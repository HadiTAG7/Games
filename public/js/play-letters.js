/* global $, h, emit, toast, socket, app, state, screenKey: writable, confetti, timerEl, PLAY_GAMES, otherTeam, teamLabel,
   teamShort, scoreboardEl, hrBoard, hrSides, hrLetter, hrBuzzStatus, hrRulesList, hrRoundTitle */
'use strict';

// Player screens for «حروف»: the board, and a big buzzer while a question is
// open. The answer only reaches phones in the host's judgement.
(() => {
const myTeam = () => state.me.team;
let pressedStep = null; // the step this phone already buzzed on

function topbar() {
  const team = myTeam();
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'حروف 🔤'),
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
    h('div', { class: 'tc-mates' }, mates.length ? `معك: ${mates.join(' · ')}` : 'لسا ما أحد معك'),
    h('div', { class: 'tc-mates' }, team === 'red' ? 'توصّلون من اليمين لليسار ↔' : 'توصّلون من فوق لتحت ↕'),
  );
}

function renderLobby() {
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, '👋'),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    teamCard(),
    h('p', { class: 'muted center' }, 'انتظر المضيف يبدأ اللعبة…'),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), hrRulesList(state.settings)),
  );
}

function renderPick() {
  const mine = state.picker === myTeam();
  return h('main', { class: 'stage narrow hr-stage' },
    h('div', { class: `tc-turn ${state.picker}${mine ? ' mine' : ''}` },
      mine ? 'دوركم! اختاروا حرف وقولوه للمضيف 🎯' : `دور ${teamLabel(state.picker)} يختار حرف`),
    hrBoard(state),
    hrSides(),
    scoreboardEl(state),
  );
}

async function pressBuzzer(button) {
  if (pressedStep === state.step) return;
  pressedStep = state.step;
  button.classList.add('pressed');
  navigator.vibrate?.(60);
  const res = await emit(socket, 'player:buzz');
  if (!res.ok) toast(res.error);
  else if (!res.first) button.classList.add('late');
}

function buzzer() {
  const { current } = state;
  const team = myTeam();
  if (!team) return h('p', { class: 'muted center' }, 'ما عندك فريق');
  if (current.locked.includes(team)) {
    return h('div', { class: 'hr-buzzer locked' }, h('span', {}, '🚫'), h('small', {}, 'فريقكم جاوب غلط، الفرصة للفريق الثاني'));
  }
  const button = h('button', {
    type: 'button',
    class: `hr-buzzer ${team}${pressedStep === state.step ? ' pressed' : ''}`,
    'aria-label': 'البازر',
    onpointerdown: (e) => { e.preventDefault(); pressBuzzer(button); },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') pressBuzzer(button); },
  }, h('span', {}, '🔔'), h('small', {}, 'اضغط!'));
  return button;
}

function renderQuestion() {
  const { current, phase } = state;
  const parts = [hrLetter(current.letter), h('div', { class: 'sj-q hr-q', dir: 'auto' }, current.question)];
  if (phase === 'question') {
    parts.push(buzzer(), h('p', { class: 'hint center' }, hrBuzzStatus(current)));
  } else if (phase === 'answer') {
    const { buzz } = current;
    const me = buzz.playerId === state.me.id;
    const mine = buzz.team === myTeam();
    parts.push(h('div', { class: `tc-turn ${buzz.team}${me ? ' mine' : ''}` },
      me ? 'أنت ضغطت أول! جاوب بصوت عالي 🔥' : buzz.name ? `🔔 ${buzz.name} ضغط أول${mine ? ' (من فريقك)' : ''}` : `🔔 ${teamLabel(buzz.team)} يجاوب`,
      timerEl(buzz.endsAt)));
  } else {
    parts.push(h('div', { class: 'sj-result none' }, 'الفريقين غلطوا 😅 المضيف بيقرر'));
  }
  parts.push(h('div', { class: 'hr-mini' }, hrBoard(state, { current: current.cell })), scoreboardEl(state));
  return h('main', { class: 'stage narrow hr-stage' }, parts);
}

function renderRoundOver() {
  const won = state.result.winner === myTeam();
  return h('main', { class: 'stage narrow hr-stage' },
    h('div', { class: `verdict ${won ? 'good' : 'bad'}` }, won ? 'فريقكم وصّل وكسب الجولة! 🎉' : hrRoundTitle(state.result)),
    hrBoard(state),
    scoreboardEl(state),
    h('p', { class: 'hint center' }, state.matchWinner ? 'انتظر النتيجة النهائية…' : 'انتظر الجولة الجاية…'),
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
  pick: renderPick,
  question: renderQuestion,
  answer: renderQuestion,
  missed: renderQuestion,
  roundOver: renderRoundOver,
  final: renderFinal,
};

function render() {
  screenKey = 'letters';
  const key = JSON.stringify([state.phase, state.step, state.me, state.score, state.board, state.current, state.settings,
    ['lobby', 'final'].includes(state.phase) && state.teams]);
  if ($('#hr-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'hr-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

PLAY_GAMES.letters = { render };
})();
