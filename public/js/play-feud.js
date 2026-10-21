/* global $, h, emit, toast, socket, app, state, screenKey: writable, confetti, timerEl, PLAY_GAMES, otherTeam, teamLabel,
   teamShort, sfx, ffRoundTitle, ffScore, ffSource, ffBoard, ffStrikes, ffPot, ffResultText, ffWinnerText, ffRulesList, ffFastTable, icon */
'use strict';

// Player screens for «فاميلي فيود»: the board (answers show as they open),
// a buzzer for the two in the face-off, and five answer boxes for whoever
// plays «المال السريع».
(() => {
const myTeam = () => state.me.team;
let pressedStep = null;
let fastAnswers = ['', '', '', '', ''];
let fastKey = '';
let fastTimer = null;
let duplicates = [];

function topbar() {
  const team = myTeam();
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'فاميلي فيود ', icon('chart-bar-big')),
    team ? h('div', { class: `pill team-pill ${team}` }, teamLabel(team)) : null,
    h('div', { class: 'pill' }, state.me.name),
  );
}

function renderLobby() {
  const team = myTeam();
  const mates = team ? state.teams[team].filter((p) => p.id !== state.me.id).map((p) => p.name) : [];
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, icon('hand')),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    team ? h('div', { class: `tc-myteam ${team}` }, h('small', {}, 'فريقك'), h('b', {}, teamLabel(team)),
      h('div', { class: 'tc-mates' }, mates.length ? `معك: ${mates.join(' · ')}` : 'لسا ما أحد معك')) : null,
    h('p', { class: 'muted center' }, 'انتظر المضيف يبدأ اللعبة…'),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), ffRulesList(state.settings)),
  );
}

async function pressBuzzer(button) {
  if (pressedStep === state.step) return;
  pressedStep = state.step;
  button.classList.add('pressed');
  sfx.play('buzz');
  navigator.vibrate?.(60);
  const res = await emit(socket, 'player:ff-buzz');
  if (!res.ok) {
    button.classList.add('late');
    toast(res.error);
  }
}

/** What this phone shows about the round's turn. */
function turnLine(round) {
  const team = myTeam();
  const f = round.faceoff;
  if (state.phase === 'faceoff') {
    const mine = Object.values(f.players).some((p) => p?.id === state.me.id);
    if (!f.turn && mine) {
      const button = h('button', {
        type: 'button',
        class: `hr-buzzer ${team}${pressedStep === state.step ? ' pressed' : ''}`,
        'aria-label': 'البازر',
        onpointerdown: (e) => { e.preventDefault(); pressBuzzer(button); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') pressBuzzer(button); },
      }, h('span', {}, icon('bell-ring')), h('small', {}, 'اضغط لو عرفت!'));
      return [h('div', { class: 'tc-turn mine' }, 'أنت في المواجهة! أول واحد يضغط يجاوب'), button];
    }
    if (!f.turn) {
      const vs = ['red', 'blue'].map((t) => f.players[t]?.name ?? teamShort(t)).join(' ضد ');
      return h('div', { class: 'tc-turn' }, icon('bell-ring'), ` مواجهة: ${vs}`);
    }
    const me = f.buzz?.player?.id === state.me.id && f.tries.length === 0;
    return h('div', { class: `tc-turn ${f.turn}${me ? ' mine' : ''}` },
      me ? 'ضغطت أول! قل جوابك بصوت عالي' : `${f.buzz?.player && f.tries.length === 0 ? f.buzz.player.name : teamLabel(f.turn)} يجاوب`);
  }
  if (state.phase === 'choose') {
    return h('div', { class: `tc-turn ${round.control}${round.control === team ? ' mine' : ''}` },
      round.control === team ? 'فزتوا بالمواجهة! قولوا للمضيف: نلعب ولا نمرر؟' : `${teamLabel(round.control)} يقررون يلعبون ولا يمررون`);
  }
  if (state.phase === 'play') {
    return h('div', { class: `tc-turn ${round.playing}${round.playing === team ? ' mine' : ''}` },
      round.playing === team ? 'دوركم! قولوا أجوبة للمضيف' : `دور ${teamLabel(round.playing)} يجاوبون`);
  }
  if (state.phase === 'steal') {
    const thief = otherTeam(round.playing);
    return h('div', { class: `tc-turn ${thief}${thief === team ? ' mine' : ''}` },
      thief === team ? [icon('hand-grab'), ` فرصتكم تسرقون ${round.pot} نقطة! اتفقوا على جواب واحد`] : `${teamLabel(thief)} يحاولون يسرقون النقاط`);
  }
  const text = ffResultText(round.result);
  return h('div', { class: `verdict ${round.result.winner === team ? 'good' : team ? 'bad' : ''}` }, text.title, h('div', { class: 'verdict-note' }, text.detail));
}

function renderRound() {
  const { round } = state;
  return h('main', { class: 'stage narrow ff-stage' },
    ffRoundTitle(state),
    turnLine(round),
    h('h1', { class: 'ff-question small' }, round.q),
    h('div', { class: 'ff-meta' }, ffSource(round), ffPot(round), ffStrikes(round.strikes)),
    ffBoard(round),
    ffScore(state, { myTeam: myTeam() }),
  );
}

/* ---------- «المال السريع» ---------- */

function sendFast(done = false) {
  clearTimeout(fastTimer);
  const go = async () => {
    const res = await emit(socket, 'player:ff-fast', { answers: fastAnswers, done });
    if (!res.ok) {
      toast(res.error);
      return;
    }
    duplicates = res.duplicates ?? [];
    for (const i of duplicates) fastAnswers[i] = '';
    document.querySelectorAll('.ff-fast-input').forEach((input, i) => {
      if (duplicates.includes(i)) input.value = '';
      input.closest('label').classList.toggle('dup', duplicates.includes(i));
    });
  };
  if (done) go();
  else fastTimer = setTimeout(go, 250);
}

function renderFast() {
  const { fast } = state;
  const meIndex = fast.players.findIndex((p) => p?.id === state.me.id);
  if (meIndex !== fast.stage) {
    const name = fast.players[fast.stage]?.name ?? 'اللاعب';
    return h('main', { class: 'stage narrow ff-stage' },
      h('div', { class: 'ff-fast-title' }, icon('zap'), ' المال السريع'),
      h('p', { class: 'center' }, `${name} يجاوب الحين…`),
      timerEl(fast.endsAt),
      meIndex === 1 ? h('p', { class: 'hint center' }, 'لا تسمع أجوبة اللاعب الأول بعدها دورك') : null,
    );
  }
  const key = `${state.roundNumber}:${fast.stage}`;
  if (fastKey !== key) {
    fastKey = key;
    fastAnswers = ['', '', '', '', ''];
    duplicates = [];
  }
  return h('main', { class: 'stage narrow ff-stage' },
    h('div', { class: 'ff-fast-title' }, icon('zap'), ' دورك! جاوب بسرعة'),
    timerEl(fast.endsAt),
    h('p', { class: 'hint center' }, 'اكتب أول جواب يجيك. لو خلص الوقت، اللي كتبته ينرسل لحاله'),
    h('form', { class: 'ff-fast-form', onsubmit: (e) => { e.preventDefault(); sendFast(true); } },
      fast.questions.map((q, i) => h('label', { class: `field ff-fast-field${duplicates.includes(i) ? ' dup' : ''}` },
        h('span', {}, `${i + 1}. ${q.q}`),
        h('input', {
          class: 'ff-fast-input',
          maxlength: 40,
          autocomplete: 'off',
          enterkeyhint: i < 4 ? 'next' : 'done',
          value: fastAnswers[i],
          oninput: (e) => { fastAnswers[i] = e.target.value; sendFast(); },
          onkeydown: (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const next = document.querySelectorAll('.ff-fast-input')[i + 1];
            if (next) next.focus();
            else sendFast(true);
          },
        }),
        h('small', { class: 'ff-dup-note' }, 'مكرر! جاوب غيره'))),
      h('button', { type: 'submit', class: 'btn primary big' }, 'خلصت ', icon('circle-check'))),
  );
}

function renderFastWait() {
  const { fast } = state;
  return h('main', { class: 'stage narrow ff-stage' },
    h('div', { class: 'ff-fast-title' }, icon('zap'), ' المال السريع'),
    state.phase === 'fastSetup'
      ? h('p', { class: 'center' }, `${teamLabel(fast.team)} فاز! واثنين منهم بيحاولون يجمعون ${fast.target} نقطة`)
      : null,
    state.phase === 'fastReview' ? ffFastTable(fast) : null,
    state.phase === 'fastReview' ? h('div', { class: 'ff-fast-total' }, h('small', {}, 'المجموع'), h('b', {}, fast.shownTotal), h('small', {}, ` من ${fast.target}`)) : null,
  );
}

function renderFinal() {
  const winner = state.matchWinner;
  const won = winner && winner === myTeam();
  const { fast } = state;
  return h('main', { class: 'stage narrow final' },
    won ? confetti() : null,
    h('div', { class: 'trophy' }, won ? icon('trophy') : winner ? icon('gamepad-2') : icon('handshake')),
    h('h1', { class: 'center' }, winner ? (won ? ['فريقكم فاز! ', icon('trophy')] : ffWinnerText(winner)) : ['تعادل! ', icon('handshake')]),
    ffScore(state, { myTeam: myTeam() }),
    fast && fast.won !== null ? h('div', { class: `verdict ${fast.won ? 'good' : 'bad'}` },
      fast.won ? [icon('zap'), ` فازوا بالمال السريع! ${fast.total} نقطة`] : [icon('zap'), ` المال السريع: ${fast.total} من ${fast.target}`]) : null,
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

const SCREENS = {
  lobby: renderLobby,
  faceoff: renderRound,
  choose: renderRound,
  play: renderRound,
  steal: renderRound,
  roundOver: renderRound,
  fastSetup: renderFastWait,
  fast: renderFast,
  fastReview: renderFastWait,
  final: renderFinal,
};

function render() {
  // Don't rebuild the answer boxes while the fast-money player is typing.
  const typing = state.phase === 'fast' && state.fast.players[state.fast.stage]?.id === state.me.id;
  const key = typing ? `ff:fast:${state.fast.stage}` : `ff:${JSON.stringify([state.phase, state.step, state.score, state.round, state.fast, state.me,
    state.phase === 'lobby' && state.teams, state.settings])}`;
  if (screenKey === key && $('#ff-root')) return;
  screenKey = key;
  const main = SCREENS[state.phase]();
  main.id = 'ff-root';
  app.replaceChildren(topbar(), main);
}

function sounds(prev, next) {
  if (prev.phase === next.phase && prev.step === next.step) return;
  const before = prev.round;
  const now = next.round;
  if (now && before && now.q === before.q && now.slots.filter((s) => s.open).length > before.slots.filter((s) => s.open).length) sfx.play('correct');
  else if (now && before && now.q === before.q && now.strikes > before.strikes) sfx.play('wrong');
  if (next.phase === 'fast' && next.fast.players[next.fast.stage]?.id === next.me.id && prev.phase !== 'fast') sfx.play('turn');
}

const won = (s) => Boolean(s.matchWinner && s.matchWinner === s.me.team);

PLAY_GAMES.feud = { render, sounds, won };
})();
