/* global $, h, storage, act, state, app, field, joinCard, gamePicker, endGame, confetti, HOST_GAMES, teamsSection,
   updateTeamsSection, timerEl, otherTeam, teamLabel, teamShort, sfx, noPhonesCard, remoteButton, isRemote, TEAM_ORDER,
   ffRoundTitle, ffScore, ffSource, ffBoard, ffStrikes, ffPot, ffResultText, ffWinnerText, ffRulesList, ffFastTable */
'use strict';

// Host screens for «فاميلي فيود». The host opens the answers the teams say
// and marks the misses. The big screen hides the closed answers; the host's
// phone («📱 تحكم من جوالك») or a peek on this screen shows them.
(() => {
const PEEK_KEY = 'ff:peek';
let busy = false;

/** Does this screen show the closed answers? The host's phone does by default; the big screen doesn't. */
const peeking = () => storage(PEEK_KEY) ?? isRemote();
function setPeek(on) {
  storage(PEEK_KEY, on);
  render(true);
}

/** Board actions carry the step they were pressed on, so a double tap only counts once. */
const judge = (event, payload = {}) => act(event, { ...payload, step: state.step });

async function send(event, payload = {}) {
  if (busy) return;
  busy = true;
  const release = setTimeout(() => { busy = false; }, 3000);
  try {
    await act(event, { ...payload, step: state.step });
  } finally {
    clearTimeout(release);
    busy = false;
  }
}

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'فاميلي فيود 👪'),
    inGame ? remoteButton() : null,
    h('div', { class: 'pill' }, 'الغرفة ', h('b', {}, state.code)),
  );
}

/* ---------- Lobby ---------- */

function renderLobby() {
  const s = state.settings;
  return h('main', { class: 'lobby' },
    s.phones ? joinCard() : noPhonesCard('قسّموا أنفسكم فريقين. المضيف يحدد مين سبق في المواجهة، ويفتح الأجوبة اللي يقولونها.'),
    h('section', { class: 'card' },
      gamePicker(),
      s.phones ? teamsSection() : null,
      s.phones ? h('button', { type: 'button', class: 'btn small sj-nophones-btn', onclick: () => act('host:settings', { phones: false }) },
        '📺 نلعب بدون جوالات') : null,
      h('h2', {}, 'الإعدادات'),
      h('div', { class: 'settings' },
        field('عدد الجولات', h('select', { id: 'ff-rounds', onchange: (e) => act('host:settings', { rounds: Number(e.target.value) }) },
          state.rules.roundsOptions.map((n) => h('option', { value: n, selected: n === s.rounds }, `${n} جولات`)))),
        field('⚡ المال السريع', h('select', { id: 'ff-fast', onchange: (e) => act('host:settings', { fastMoney: e.target.value === 'on' }) },
          [['on', 'بالنهاية للفريق الفايز'], ['off', 'بدون']].map(([v, label]) => h('option', { value: v, selected: (v === 'on') === s.fastMoney }, label)))),
      ),
      h('p', { class: 'hint' }, `📱 الأجوبة تطلع للمضيف بس: افتح اللعبة على الشاشة الكبيرة، وتحكم من جوالك بزر «📱 تحكم من جوالك» (يطلع أول ما تبدأ). ${state.questionCount} سؤال.`),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: () => send('host:start') }, 'ابدأ اللعبة 👪'),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  if (state.settings.phones) updateTeamsSection();
  $('#rules-body').replaceChildren(ffRulesList(state.settings));
  const ready = !state.settings.phones || (state.teams.red.length > 0 && state.teams.blue.length > 0);
  $('#start').disabled = !ready;
  $('#start-hint').textContent = ready ? '' : 'كل فريق يحتاج لاعب واحد على الأقل (أو العبوا بدون جوالات)';
}

/* ---------- A round ---------- */

function peekToggle() {
  const on = peeking();
  return h('button', { type: 'button', class: `btn small ff-peek${on ? ' on' : ''}`, onclick: () => setPeek(!on) },
    on ? '🙈 أخفِ الأجوبة عن هالشاشة' : '👁️ أظهر الأجوبة على هالشاشة');
}

function faceoffPanel(round) {
  const f = round.faceoff;
  const who = (team) => f.players[team]?.name ?? teamShort(team);
  if (!f.turn) {
    return [
      h('div', { class: 'ff-status' }, `🔔 مواجهة: ${teamShort('red')} ${f.players.red ? `(${who('red')})` : ''} ضد ${teamShort('blue')} ${f.players.blue ? `(${who('blue')})` : ''}`),
      h('p', { class: 'hint center' }, state.settings.phones ? 'أول واحد يضغط البازر في جواله يجاوب. أو حدد أنت مين سبق:' : 'مين سبق؟'),
      h('div', { class: 'actions' }, TEAM_ORDER.map((team) => h('button', {
        type: 'button', class: `btn ff-team-btn ${team}`, onclick: () => judge('host:ff-buzz', { team }),
      }, `${teamShort(team)} سبق`))),
    ];
  }
  const first = f.tries.length === 0;
  return [
    h('div', { class: `ff-status ${f.turn}` }, first && f.buzz?.player
      ? `🔔 ${f.buzz.player.name} (${teamShort(f.turn)}) ضغط أول! يجاوب`
      : `${teamLabel(f.turn)} يجاوب${first ? '' : ' (لازم جواب أعلى عشان ياخذون الدور)'}`),
    h('p', { class: 'hint center' }, 'اضغط الجواب في اللوحة لو موجود، أو ❌'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ff-miss', onclick: () => judge('host:ff-miss') }, '❌ مو موجود')),
  ];
}

function controlPanel(round) {
  if (state.phase === 'faceoff') return faceoffPanel(round);
  if (state.phase === 'choose') {
    return [
      h('div', { class: `ff-status ${round.control}` }, `${teamLabel(round.control)} فاز بالمواجهة: يلعبون ولا يمررون؟`),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => judge('host:ff-choose', { play: true }) }, '▶️ يلعبون'),
        h('button', { type: 'button', class: 'btn', onclick: () => judge('host:ff-choose', { play: false }) }, `↩️ يمررون لـ${teamShort(otherTeam(round.control))}`)),
    ];
  }
  if (state.phase === 'play') {
    return [
      h('div', { class: `ff-status ${round.playing}` }, `دور ${teamLabel(round.playing)}: قولوا أجوبة`),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ff-miss', onclick: () => judge('host:ff-miss') }, '❌ غلط')),
    ];
  }
  if (state.phase === 'steal') {
    const thief = otherTeam(round.playing);
    return [
      h('div', { class: `ff-status ${thief}` }, `🦊 فرصة ${teamLabel(thief)} يسرق ${round.pot} نقطة! جواب واحد بس`),
      h('p', { class: 'hint center' }, 'لو جوابهم في اللوحة اضغطه، وإلا ❌ والنقاط تروح للفريق الثاني'),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ff-miss', onclick: () => judge('host:ff-miss') }, '❌ غلط')),
    ];
  }
  const text = ffResultText(round.result);
  const last = state.roundNumber >= state.rounds;
  return [
    h('div', { class: `verdict ff-verdict ${round.result.winner}` }, text.title, h('div', { class: 'verdict-note' }, text.detail)),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary big', onclick: () => send('host:next') },
      last ? (state.settings.fastMoney ? 'النتيجة ⚡' : 'النتيجة 🏆') : 'الجولة الجاية ▶️')),
  ];
}

function renderRound() {
  const { round } = state;
  const peek = peeking();
  const canOpen = ['faceoff', 'play', 'steal'].includes(state.phase) && (state.phase !== 'faceoff' || round.faceoff.turn);
  return h('main', { class: 'stage ff-stage' },
    h('div', { class: 'ff-head' }, ffRoundTitle(state), ffScore(state)),
    h('h1', { class: 'ff-question' }, round.q),
    h('div', { class: 'ff-meta' }, ffSource(round), ffPot(round), ffStrikes(round.strikes)),
    ffBoard(round, { peek, onSlot: canOpen ? (slot) => judge('host:ff-reveal', { slot }) : null }),
    ...controlPanel(round),
    h('div', { class: 'actions ff-tools' },
      peekToggle(),
      h('button', { type: 'button', class: 'btn small', disabled: !round.canUndo, onclick: () => judge('host:ff-undo') }, '↩︎ تراجع'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: endGame }, 'إنهاء اللعبة')),
    h('p', { class: 'hint center kbd-hint' }, 'الكيبورد: 1–8 = افتح الجواب · X = غلط · Z = تراجع · مسافة = التالي'),
  );
}

/* ---------- «المال السريع» ---------- */

function renderFastSetup() {
  const { fast } = state;
  const members = state.teams[fast.team];
  const pick = (index) => (members.length
    ? h('select', { id: `ff-fast-p${index}`, onchange: (e) => act('host:ff-fast-player', { index, playerId: e.target.value }) },
      members.map((p) => h('option', { value: p.id, selected: fast.players[index]?.id === p.id }, p.name)))
    : h('b', {}, index ? 'اللاعب الثاني' : 'اللاعب الأول'));
  return h('main', { class: 'stage narrow ff-stage' },
    ffScore(state),
    h('div', { class: 'ff-fast-title' }, '⚡ المال السريع'),
    h('p', { class: 'center' }, `${teamLabel(fast.team)} فاز! والحين اثنين منهم يحاولون يجمعون ${fast.target} نقطة.`),
    h('div', { class: 'settings' }, field('اللاعب الأول (20 ثانية)', pick(0)), field('اللاعب الثاني (25 ثانية)', pick(1))),
    h('p', { class: 'hint center' }, state.settings.phones
      ? '5 أسئلة يكتب أجوبتها في جواله. والثاني ما يسمع أجوبة الأول، فخلّوه يطلع أو يسد أذونه 🙉'
      : 'المضيف يقرأ الأسئلة، واللاعب يجاوب بصوت عالي، والمضيف يختار الجواب المطابق.'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary big', onclick: () => send('host:ff-fast-start') }, 'ابدأ وقت اللاعب الأول ⏱️')),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة')),
  );
}

// Picking a player or a match just sets it, so a quick second change isn't a stale tap: no step.
const mark = (stage, index, slot) => act('host:ff-fast-mark', { stage, index, slot });

function renderFast() {
  const { fast } = state;
  const player = fast.players[fast.stage]?.name ?? (fast.stage ? 'اللاعب الثاني' : 'اللاعب الأول');
  const peek = peeking();
  return h('main', { class: 'stage ff-stage' },
    h('div', { class: 'ff-fast-title' }, `⚡ ${player} يجاوب`),
    timerEl(fast.endsAt),
    h('p', { class: 'center muted' }, state.settings.phones ? 'يكتب أجوبته في جواله…' : 'اقرأ الأسئلة، واختر الجواب المطابق لكل واحد:'),
    !state.settings.phones || peek ? h('ol', { class: 'ff-fast-live' }, fast.questions.map((q, i) => h('li', {},
      h('b', {}, q.q),
      h('div', { class: 'chips' }, q.answers.map((a, j) => h('button', {
        type: 'button',
        class: `category-chip${fast.stages[fast.stage][i]?.slot === j ? ' picked' : ''}`,
        disabled: fast.stage === 1 && fast.stages[0][i]?.slot === j,
        onclick: () => mark(fast.stage, i, j),
      }, `${a.a} (${a.points})`)))))) : null,
    h('div', { class: 'actions ff-tools' }, peekToggle()),
  );
}

function renderFastReview() {
  const { fast } = state;
  const peek = peeking();
  const done = fast.shown[fast.stage] >= state.rules.fastQuestions;
  // The big screen shows only what's been revealed; the host's phone sees it all and can correct.
  const view = peek ? fast : { ...fast, stages: fast.stages.map((col, s) => col.map((c, i) => (s <= fast.stage && i < fast.shown[s] ? c : null))) };
  return h('main', { class: 'stage ff-stage' },
    h('div', { class: 'ff-fast-title' }, '⚡ المال السريع'),
    ffFastTable(view, { onMark: peek ? mark : null }),
    h('div', { class: 'ff-fast-total' }, h('small', {}, 'المجموع'), h('b', {}, fast.shownTotal), h('small', {}, ` من ${fast.target}`)),
    h('div', { class: 'actions' }, !done
      ? h('button', { type: 'button', class: 'btn primary big', onclick: () => send('host:next') }, 'اكشف الجواب التالي ▶️')
      : fast.stage === 0
        ? h('button', { type: 'button', class: 'btn primary big', onclick: () => send('host:ff-fast-start') }, 'ابدأ وقت اللاعب الثاني ⏱️')
        : h('button', { type: 'button', class: 'btn primary big', onclick: () => send('host:next') }, 'النتيجة 🏆')),
    h('div', { class: 'actions ff-tools' }, peekToggle()),
  );
}

/* ---------- End ---------- */

function renderFinal() {
  const winner = state.matchWinner;
  const { fast } = state;
  return h('main', { class: 'stage narrow final ff-stage' },
    winner ? confetti() : null,
    h('div', { class: 'trophy' }, winner ? '🏆' : '🤝'),
    h('h1', { class: 'winner-name' }, ffWinnerText(winner)),
    ffScore(state),
    fast && fast.won !== null ? h('div', { class: `verdict ${fast.won ? 'good' : 'bad'}` },
      fast.won ? `⚡ فازوا بالمال السريع! ${fast.total} نقطة 🎉` : `⚡ المال السريع: ${fast.total} من ${fast.target}، قريبين!`) : null,
    fast && fast.won !== null ? ffFastTable(fast) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => act('host:restart') }, 'لعبة جديدة 🔁')),
  );
}

/* ---------- Render ---------- */

const SCREENS = {
  faceoff: renderRound,
  choose: renderRound,
  play: renderRound,
  steal: renderRound,
  roundOver: renderRound,
  fastSetup: renderFastSetup,
  fast: renderFast,
  fastReview: renderFastReview,
  final: renderFinal,
};

function render(force = false) {
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  const key = JSON.stringify([state.phase, state.step, state.score, state.round, state.fast, peeking(),
    state.phase === 'fastSetup' && state.teams]);
  if (!force && $('#ff-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'ff-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

/** Keyboard: 1–8 open an answer, X a miss, Z undo, space the next step. */
document.addEventListener('keydown', (e) => {
  if (!state || state.gameType !== 'feud' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const playing = ['faceoff', 'play', 'steal'].includes(state.phase);
  const digit = /^Digit([1-8])$/.exec(e.code);
  if (digit && playing) judge('host:ff-reveal', { slot: Number(digit[1]) - 1 });
  else if (e.code === 'KeyX' && playing) judge('host:ff-miss');
  else if (e.code === 'KeyZ' && state.round?.canUndo) judge('host:ff-undo');
  else if (e.code === 'Space' && ['roundOver', 'fastReview'].includes(state.phase)) send('host:next');
  else return;
  e.preventDefault();
});

function sounds(prev, next) {
  if (!prev || prev.gameType !== 'feud') return;
  const before = prev.round;
  const now = next.round;
  if (now && before && now.q === before.q) {
    const opened = now.slots.filter((s) => s.open).length > before.slots.filter((s) => s.open).length;
    const missedFaceoff = now.faceoff.tries.length > before.faceoff.tries.length && now.faceoff.tries.at(-1).slot === null;
    if (opened) sfx.play('correct');
    else if (now.strikes > before.strikes || missedFaceoff || (prev.phase === 'steal' && next.phase === 'roundOver')) sfx.play('wrong');
    if (now.faceoff.buzz && !before.faceoff.buzz) sfx.play('buzz');
  }
  if (next.phase === 'steal' && prev.phase !== 'steal') sfx.play('steal');
  if (next.phase === 'final' && prev.phase !== 'final') sfx.play('win');
}

const lobbyKey = () => String(state.settings.phones);

HOST_GAMES.feud = { render, updateLobby, sounds, lobbyKey };
})();
