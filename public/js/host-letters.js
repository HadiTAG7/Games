/* global $, h, storage, act, state, app, field, joinCard, gamePicker, endGame, confetti, HOST_GAMES, teamsSection,
   updateTeamsSection, timerEl, teamLabel, teamShort, scoreboardEl, roundsText, hrBoard, hrSides, hrLetter,
   hrBuzzStatus, hrRulesList, hrRoundTitle, sfx */
'use strict';

// Host screens for «حروف». The host taps the letter a team picks, reads the
// question, sees who buzzed first on their phone, and judges the answer.
(() => {
const PREFS_KEY = 'hr:host-prefs';
let prefs = { answer: true, ...storage(PREFS_KEY) };
let busy = false;

function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  storage(PREFS_KEY, prefs);
  render();
}

/** Actions carry the step they were pressed on, so the server ignores a double tap. */
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

function sounds(prev, next) {
  if (prev.step === next.step) return;
  const from = prev.phase;
  const to = next.phase;
  if (to === 'answer' && from !== 'answer') sfx.play('buzz');
  else if (from === 'answer' && (to === 'question' || to === 'missed')) sfx.play('wrong');
  else if (from === 'answer' && to === 'pick') sfx.play('correct');
  else if (from === 'answer' && to === 'roundOver') sfx.play('win');
  else if (to === 'question' && (from === 'pick' || from === 'missed')) sfx.play('reveal');
}

document.addEventListener('keydown', (e) => {
  if (!state || state.gameType !== 'letters' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select')) return;
  let action = null;
  if (state.phase === 'answer' && e.code === 'KeyC') action = ['host:hr-judge', { correct: true }];
  else if (state.phase === 'answer' && e.code === 'KeyX') action = ['host:hr-judge', { correct: false }];
  else if (['question', 'missed'].includes(state.phase) && e.code === 'KeyN') action = ['host:hr-new'];
  if (!action) return;
  e.preventDefault();
  send(...action);
});

/* ---------- Shared bits ---------- */

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'حروف 🔤'),
    inGame ? h('div', { class: 'pill' }, `الجولة ${state.roundNumber}`) : null,
    h('div', { class: 'pill' }, 'الغرفة ', h('b', {}, state.code)),
  );
}

function answerBox(answer, { always = false } = {}) {
  const masked = !prefs.answer && !always;
  return h('button', {
    type: 'button',
    class: `tc-answer${masked ? ' masked' : ''}`,
    title: masked ? 'اضغط عشان تشوف الجواب' : 'اضغط عشان تخفي الجواب (لو الشاشة قدام الكل)',
    onclick: () => { if (!always) savePrefs({ answer: masked }); },
  },
    h('small', {}, masked ? '🙈 الجواب مخفي — اضغط عشان تشوفه' : 'الجواب'),
    h('b', {}, answer),
  );
}

/* ---------- Lobby ---------- */

function renderLobby() {
  return h('main', { class: 'lobby' },
    joinCard(),
    h('section', { class: 'card' },
      gamePicker(),
      teamsSection(),
      h('h2', {}, 'الإعدادات'),
      h('div', { class: 'settings' },
        field('يفوز باللعبة اللي يكسب', h('select', {
          id: 'hr-rounds',
          onchange: (e) => act('host:settings', { roundsToWin: Number(e.target.value) }),
        }, [1, 2, 3, 4].map((n) => h('option', { value: n, selected: n === state.settings.roundsToWin }, roundsText(n))))),
      ),
      h('p', { class: 'hint' }, `${state.letterCount} حرف، والأسئلة ما تتكرر في نفس الغرفة. اللاعبين يضغطون البازر من جوالاتهم.`),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: () => send('host:start') }, 'ابدأ اللعبة 🔤'),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  updateTeamsSection();
  $('#rules-body').replaceChildren(hrRulesList(state.settings));
  const ready = state.teams.red.length > 0 && state.teams.blue.length > 0;
  $('#start').disabled = !ready;
  $('#start-hint').textContent = !state.players.length
    ? 'امسحوا الباركود وادخلوا، واللعبة تقسمكم فريقين'
    : ready ? '' : 'كل فريق يحتاج لاعب واحد على الأقل';
}

/* ---------- The board ---------- */

function renderPick() {
  return h('main', { class: 'stage hr-stage' },
    scoreboardEl(state),
    h('div', { class: `sj-turn ${state.picker}` }, `دور ${teamLabel(state.picker)}: اختاروا حرف`),
    h('div', { class: 'hr-main' }, hrBoard(state, { onPick: (cell) => send('host:hr-pick', { cell }) })),
    hrSides(),
    h('div', { class: 'actions' },
      state.canUndo ? h('button', { class: 'btn', onclick: () => send('host:hr-undo') }, '↩︎ تراجع عن آخر حكم') : null,
      h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
  );
}

function questionPanel() {
  const { current, phase } = state;
  const status = hrBuzzStatus(current);
  const panel = [
    hrLetter(current.letter),
    h('div', { class: 'sj-q hr-q', dir: 'auto' }, current.question),
  ];
  if (phase === 'answer') {
    const { buzz } = current;
    panel.push(
      h('div', { class: `sj-turn ${buzz.team} hr-buzzed` },
        buzz.name ? `🔔 ${buzz.name} (${teamShort(buzz.team)}) ضغط أول!` : `🔔 ${teamLabel(buzz.team)} يجاوب`,
        timerEl(buzz.endsAt)),
      answerBox(current.answer),
      h('div', { class: 'tc-judge' },
        h('button', { class: 'btn tc-correct', onclick: () => send('host:hr-judge', { correct: true }) }, '✅ صح'),
        h('button', { class: 'btn tc-skip', onclick: () => send('host:hr-judge', { correct: false }) }, '❌ غلط'),
      ),
      h('p', { class: 'hint center kbd-hint' }, 'الكيبورد: C = صح · X = غلط'),
    );
  } else if (phase === 'missed') {
    panel.push(
      h('div', { class: 'sj-result none' }, 'الفريقين غلطوا 😅'),
      answerBox(current.answer, { always: true }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => send('host:hr-new') }, '🔄 سؤال ثاني لنفس الحرف'),
        h('button', { class: 'btn', onclick: () => send('host:hr-release') }, '↩︎ رجوع للحروف'),
      ),
    );
  } else {
    const open = ['red', 'blue'].filter((t) => !current.locked.includes(t));
    panel.push(
      h('div', { class: 'hr-status' }, status),
      answerBox(current.answer),
      h('div', { class: 'hr-manual' },
        h('span', { class: 'hint' }, 'أحد ما عنده جوال؟ '),
        open.map((team) => h('button', { class: `btn small team-btn ${team}`, onclick: () => send('host:hr-buzz', { team }) }, `${teamShort(team)} ضغط`))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => send('host:hr-new') }, '🔄 سؤال ثاني'),
        h('button', { class: 'btn ghost', onclick: () => send('host:hr-release') }, '↩︎ رجوع للحروف'),
      ),
      h('p', { class: 'hint center kbd-hint' }, 'N = سؤال ثاني'),
    );
  }
  if (state.canUndo && phase !== 'answer') {
    panel.push(h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => send('host:hr-undo') }, '↩︎ تراجع عن آخر حكم')));
  } else if (state.canUndo) {
    panel.push(h('div', { class: 'actions' }, h('button', { class: 'btn small ghost', onclick: () => send('host:hr-undo') }, '↩︎ تراجع')));
  }
  return h('section', { class: 'hr-panel' }, panel);
}

function renderQuestion() {
  return h('main', { class: 'stage hr-stage' },
    scoreboardEl(state),
    h('div', { class: 'hr-split' },
      h('div', { class: 'hr-main' }, hrBoard(state, { current: state.current.cell }), hrSides()),
      questionPanel(),
    ),
  );
}

function renderRoundOver() {
  const last = Boolean(state.matchWinner);
  return h('main', { class: 'stage hr-stage' },
    h('div', { class: `verdict tc-verdict ${state.result.winner}` }, hrRoundTitle(state.result)),
    scoreboardEl(state),
    h('div', { class: 'hr-main' }, hrBoard(state)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big tc-main-btn', onclick: () => send('host:hr-next') },
        last ? 'النتيجة النهائية 🏆' : 'الجولة الجاية 🔤'),
      h('button', { class: 'btn', onclick: () => send('host:hr-undo') }, '↩︎ تراجع عن الحكم'),
    ),
  );
}

function renderFinal() {
  const winner = state.matchWinner;
  return h('main', { class: 'stage narrow final' },
    winner ? confetti() : null,
    h('div', { class: 'trophy' }, winner ? '🏆' : '🤝'),
    h('h1', { class: 'winner-name' }, winner ? `${teamLabel(winner)} فاز!` : 'تعادل!'),
    winner && state.teams[winner].length ? h('p', { class: 'center' }, state.teams[winner].map((p) => p.name).join(' · ')) : null,
    scoreboardEl(state),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => act('host:restart') }, 'لعبة جديدة 🔁')),
  );
}

/* ---------- Render ---------- */

const SCREENS = {
  pick: renderPick,
  question: renderQuestion,
  answer: renderQuestion,
  missed: renderQuestion,
  roundOver: renderRoundOver,
  final: renderFinal,
};

function render() {
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  // Redraw only when something on screen changed (not when a phone reconnects).
  const key = JSON.stringify([state.phase, state.step, state.score, state.board, state.current, state.canUndo,
    state.phase === 'final' && state.teams, prefs]);
  if ($('#hr-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'hr-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

HOST_GAMES.letters = { render, updateLobby, sounds };
})();
