/* global $, h, app, state, screenKey: writable, confetti, timerEl, PLAY_GAMES, otherTeam, teamLabel, teamShort,
   sjAnswering, sjScoreboard, sjBoard, sjQuestion, sjHead, sjResult, sjWinnerText, sjRulesList */
'use strict';

// Player screens for «سين جيم»: the board, the question and both teams'
// points. The answer only reaches phones once the host has judged.
(() => {
const myTeam = () => state.me.team;

function topbar() {
  const team = myTeam();
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'سين جيم ❓'),
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
  );
}

function renderLobby() {
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, '👋'),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    teamCard(),
    h('p', { class: 'muted center' }, 'انتظر المضيف يختار الفئات ويبدأ…'),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), sjRulesList(state.settings)),
  );
}

function turnBanner() {
  const team = sjAnswering(state);
  const mine = team === myTeam();
  const { phase, current } = state;
  let text;
  if (phase === 'board') text = mine ? 'دوركم! قولوا للمضيف أي سؤال تبون 🎯' : `دور ${teamLabel(team)} يختار سؤال`;
  else if (phase === 'picked') text = mine ? 'دوركم! تبون وسيلة قبل السؤال؟' : `${teamLabel(team)} اختار سؤال`;
  else if (phase === 'steal') text = mine ? 'فرصتكم! جاوبوا وخذوا النقاط 🔥' : `${teamLabel(team)} يحاول يسرق النقاط`;
  else if (current?.during.includes('call')) text = mine ? '📞 اتصلوا بصديقكم!' : `📞 ${teamLabel(team)} يتصل بصديق`;
  else text = mine ? 'دوركم! جاوبوا بصوت عالي 🔥' : `${teamLabel(team)} يجاوب`;
  return h('div', { class: `tc-turn ${team}${mine ? ' mine' : ''}` }, text,
    phase === 'question' || phase === 'steal' ? timerEl(current.endsAt) : null);
}

function renderBoard() {
  return h('main', { class: 'stage narrow sj-stage' },
    turnBanner(),
    sjScoreboard(state, { myTeam: myTeam() }),
    sjBoard(state),
  );
}

function renderPicked() {
  const { current } = state;
  return h('main', { class: 'stage narrow sj-stage' },
    turnBanner(),
    h('div', { class: `sj-picked ${current.team}` },
      h('div', { class: 'sj-picked-cat' }, `${current.category.emoji} ${current.category.name}`),
      h('div', { class: 'sj-picked-value' }, current.value),
    ),
    sjHead(current),
    sjScoreboard(state, { myTeam: myTeam() }),
  );
}

function renderQuestion() {
  return h('main', { class: 'stage narrow sj-stage' },
    turnBanner(),
    sjHead(state.current),
    sjQuestion(state.current),
    sjScoreboard(state, { myTeam: myTeam(), compact: true }),
  );
}

function renderReveal() {
  const { current } = state;
  const winner = current.result?.winner;
  let kind = 'none';
  if (winner) kind = winner === myTeam() ? 'good' : 'bad';
  return h('main', { class: 'stage narrow sj-stage' },
    h('div', { class: `sj-reveal ${kind}` }, h('small', {}, 'الجواب'), h('b', {}, current.answer)),
    sjResult(current),
    sjQuestion(current),
    sjScoreboard(state, { myTeam: myTeam() }),
    h('p', { class: 'hint center' }, state.tilesLeft ? 'انتظر السؤال الجاي…' : 'انتظر النتيجة النهائية…'),
  );
}

function renderFinal() {
  const { winner } = state;
  const won = winner && winner === myTeam();
  let title = sjWinnerText(state);
  if (won) title = 'فريقكم فاز! 🏆';
  return h('main', { class: 'stage narrow final' },
    won ? confetti() : null,
    h('div', { class: 'trophy' }, won ? '🏆' : winner ? '🎮' : '🤝'),
    h('h1', { class: 'center' }, title),
    sjScoreboard(state, { myTeam: myTeam() }),
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

const SCREENS = {
  lobby: renderLobby,
  board: renderBoard,
  picked: renderPicked,
  question: renderQuestion,
  steal: renderQuestion,
  reveal: renderReveal,
  final: renderFinal,
};

function render() {
  screenKey = 'seen';
  const key = JSON.stringify([state.phase, state.step, state.me, state.score, state.lifelines, state.current,
    state.settings, ['lobby', 'final'].includes(state.phase) && state.teams]);
  if ($('#sj-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'sj-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

PLAY_GAMES.seen = { render };
})();
