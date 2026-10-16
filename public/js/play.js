/* global io, $, h, range, emit, storage, toast, toLatinDigits, connectionBanner, syncClock, timerEl, standingsList, rulesList, confetti */
'use strict';

const socket = io();
const app = $('#app');
const params = new URLSearchParams(location.search);
const sessionKey = (code) => `herd:player:${code}`;

let session = null; // { code, playerId, name }
let state = null;
let screenKey = '';
let draft = { value: null, text: '' };
let draftRound = 0;
let editing = false;

connectionBanner(socket);

socket.on('connect', () => {
  const code = session?.code || toLatinDigits(params.get('room') || '').trim();
  const saved = session || (code && storage(sessionKey(code)));
  if (saved) join(code, saved.name, saved.playerId, { rejoin: true });
  else renderJoin({ code });
});

socket.on('player:state', (next) => {
  state = next;
  syncClock(next.serverTime);
  render();
});

socket.on('player:kicked', () => {
  const code = session?.code;
  if (code) storage(sessionKey(code), null);
  session = null;
  state = null;
  renderJoin({ code, error: 'المضيف طلعك من الغرفة' });
});

async function join(code, name, playerId, { rejoin = false } = {}) {
  const res = await emit(socket, 'player:join', { code, name, playerId });
  if (!res.ok) {
    if (rejoin) {
      storage(sessionKey(code), null);
      session = null;
    }
    renderJoin({ code, name, error: res.error });
    return;
  }
  session = { code: res.code, playerId: res.playerId, name: res.name };
  storage(sessionKey(res.code), session);
  if (params.get('room') !== res.code) history.replaceState(null, '', `?room=${res.code}`);
  render();
}

/* ---------- Join ---------- */

function renderJoin({ code = '', name = '', error = '' } = {}) {
  screenKey = 'join';
  const codeInput = h('input', {
    id: 'code', inputmode: 'numeric', maxlength: 4, placeholder: '1234', autocomplete: 'off', value: code,
  });
  const nameInput = h('input', {
    id: 'name', maxlength: 20, placeholder: 'اسمك', autocomplete: 'nickname', enterkeyhint: 'go', value: name,
  });
  const button = h('button', { class: 'btn primary big', type: 'submit' }, 'ادخل');
  const form = h('form', {
    class: 'card join-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const c = toLatinDigits(codeInput.value).trim();
      const n = nameInput.value.trim();
      if (!c || !n) {
        toast('اكتب رقم الغرفة واسمك');
        return;
      }
      button.disabled = true;
      await join(c, n, storage(sessionKey(c))?.playerId);
      button.disabled = false;
    },
  },
    h('h1', { class: 'center' }, `${GAME_NAME} 🐄`),
    error ? h('p', { class: 'banner bad' }, error) : null,
    h('label', { class: 'field' }, h('span', {}, 'رقم الغرفة'), codeInput),
    h('label', { class: 'field' }, h('span', {}, 'اسمك'), nameInput),
    button,
  );
  app.replaceChildren(h('main', { class: 'narrow' }, form));
  (code ? nameInput : codeInput).focus();
}

/* ---------- Game screens ---------- */

function render() {
  if (!state || !session) return;

  if (state.phase !== 'question') {
    draftRound = 0;
  } else if (draftRound !== state.roundNumber) {
    draftRound = state.roundNumber;
    draft = { value: null, text: '' };
    editing = false;
  }

  if (state.phase === 'question') {
    const answering = !state.myAnswer || editing;
    const key = answering
      ? `form:${state.roundNumber}`
      : `sent:${state.roundNumber}:${state.myAnswer.value}:${state.myAnswer.text}`;
    // Don't rebuild the form while someone is typing; just refresh the counter.
    if (key === screenKey) {
      const counter = $('#answered');
      if (counter) counter.textContent = answeredText();
      return;
    }
    screenKey = key;
    app.replaceChildren(topbar(), answering ? renderAnswerForm() : renderSent());
    return;
  }

  screenKey = state.phase;
  const screens = { lobby: renderLobby, reveal: renderReveal, results: renderResults, final: renderFinal };
  app.replaceChildren(topbar(), screens[state.phase]());
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, `${GAME_NAME} 🐄`),
    state.phase === 'question' || state.phase === 'reveal'
      ? h('div', { class: 'pill' }, `${state.roundNumber}/${state.totalRounds}`)
      : null,
    h('div', { class: 'pill' }, state.me.pinkCow ? cowBadge() : null, state.me.name, ' · ', h('b', {}, state.me.score)),
  );
}

function answeredText() {
  return `جاوب ${state.answeredCount} من ${state.playerCount}`;
}

function renderLobby() {
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, '👋'),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    h('p', { class: 'muted center' }, 'انتظر المضيف يبدأ اللعبة…'),
    h('p', { class: 'center' }, `عدد اللاعبين: ${state.playerCount}`),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), rulesList({ pinkCow: state.pinkCow })),
  );
}

function renderAnswerForm() {
  const used = new Set(state.me.used);
  if (draft.value !== null && used.has(draft.value)) draft.value = null;

  const send = h('button', { class: 'btn primary big', type: 'submit' }, editing ? 'حدّث جوابي' : 'أرسل');
  const refresh = () => { send.disabled = !(draft.value && draft.text.trim()); };

  const bets = h('div', { class: 'bets', role: 'group', 'aria-label': 'رقم الرهان' },
    range(1, state.maxBet).map((n) => h('button', {
      type: 'button',
      class: `bet-btn${used.has(n) ? ' used' : ''}${draft.value === n ? ' picked' : ''}`,
      disabled: used.has(n),
      'aria-pressed': String(draft.value === n),
      onclick: (e) => {
        draft.value = n;
        bets.querySelectorAll('.bet-btn').forEach((b) => {
          b.classList.toggle('picked', b === e.currentTarget);
          b.setAttribute('aria-pressed', String(b === e.currentTarget));
        });
        refresh();
      },
    }, n)));

  const input = h('input', {
    class: 'answer-input',
    maxlength: 40,
    placeholder: 'اكتب جوابك…',
    autocomplete: 'off',
    enterkeyhint: 'send',
    value: draft.text,
    oninput: (e) => { draft.text = e.target.value; refresh(); },
  });

  async function submit(e) {
    e.preventDefault();
    if (send.disabled) return;
    send.disabled = true;
    const res = await emit(socket, 'player:answer', { value: draft.value, text: draft.text });
    if (!res.ok) {
      toast(res.error);
      refresh();
      return;
    }
    editing = false;
    render();
  }

  refresh();
  return h('main', { class: 'stage narrow' },
    h('form', { class: 'answer-form', onsubmit: submit },
      timerEl(state.endsAt),
      h('h1', { class: 'question' }, state.question),
      h('div', { class: 'step' }, h('span', { class: 'step-num' }, '1'), 'اختر رقم تراهن فيه'),
      bets,
      h('p', { class: 'hint' }, `كل رقم تستخدمه مرة وحدة · باقي لك ${state.maxBet - used.size} رقم`),
      h('div', { class: 'step' }, h('span', { class: 'step-num' }, '2'), 'اكتب الجواب اللي تتوقع الأغلبية تكتبه'),
      input,
      send,
      editing ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { editing = false; render(); } }, 'إلغاء التعديل') : null,
      h('p', { id: 'answered', class: 'muted center' }, answeredText()),
    ),
  );
}

function renderSent() {
  return h('main', { class: 'stage narrow' },
    timerEl(state.endsAt),
    h('h1', { class: 'question' }, state.question),
    h('div', { class: 'card sent' },
      h('div', { class: 'big-emoji' }, '✅'),
      h('p', { class: 'muted' }, 'وصل جوابك'),
      h('div', { class: 'my-answer' }, state.myAnswer.text),
      h('div', { class: 'pill' }, `راهنت بـ ${state.myAnswer.value}`),
      h('button', {
        class: 'btn ghost',
        onclick: () => {
          draft = { ...state.myAnswer };
          editing = true;
          render();
        },
      }, 'تعديل'),
    ),
    h('p', { id: 'answered', class: 'muted center' }, answeredText()),
  );
}

function renderReveal() {
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }),
    h('h2', { class: 'center' }, 'المضيف يراجع الأجوبة…'),
    h('h1', { class: 'question small' }, state.question),
    state.myAnswer
      ? h('div', { class: 'card center' }, 'جوابك: ', h('b', {}, state.myAnswer.text), ` · راهنت بـ ${state.myAnswer.value}`)
      : h('p', { class: 'muted center' }, 'ما لحقت تجاوب هالمرة'),
  );
}

function verdict(last) {
  if (!last) return h('div', { class: 'verdict' }, h('div', { class: 'big-emoji' }, '👋'), 'دخلت جديد، انتظر السؤال الجاي');
  if (!last.answered) {
    return h('div', { class: 'verdict bad' }, h('div', { class: 'big-emoji' }, '⌛'), 'ما جاوبت هالمرة',
      last.value ? h('div', { class: 'verdict-note' }, `انحرق أقل رقم عندك: ${last.value}`) : null);
  }
  if (last.won) {
    return h('div', { class: 'verdict good' },
      h('div', { class: 'big-emoji' }, '🎉'), 'فزت!', h('div', { class: 'points' }, `+${last.gained}`));
  }
  return h('div', { class: 'verdict bad' }, h('div', { class: 'big-emoji' }, '😬'), `راحت عليك الـ ${last.value}`);
}

function cowNotice() {
  const { last, me } = state;
  if (last?.pinkCow) {
    return h('div', { class: 'banner pink' }, h('div', { class: 'big-emoji' }, '🐮'),
      h('b', {}, 'أخذت البقرة الوردية!'), h('br'),
      'كنت الوحيد اللي جوابه مختلف. وهي معك ما تقدر تفوز، لين ياخذها منك أحد ثاني.');
  }
  if (me.pinkCow) return h('p', { class: 'center' }, cowBadge(), ' البقرة الوردية لسا معك');
  if (state.pinkCowTaker) return h('p', { class: 'center muted' }, cowBadge(), ` البقرة الوردية راحت لـ ${state.pinkCowTaker}`);
  return null;
}

function renderResults() {
  const winners = state.groups.filter((g) => g.winner).map((g) => g.text);
  return h('main', { class: 'stage narrow' },
    verdict(state.last),
    cowNotice(),
    h('p', { class: 'center' }, winners.length
      ? ['جواب الأغلبية: ', h('b', {}, winners.join(' / '))]
      : 'ما فيه أغلبية هالمرة'),
    state.last?.answered ? h('p', { class: 'muted center' }, `جوابك: ${state.last.text}`) : null,
    h('div', { class: 'card score-card' },
      h('div', {}, h('small', {}, 'مجموعك'), h('b', {}, state.me.score)),
      h('div', {}, h('small', {}, 'ترتيبك'), h('b', {}, `#${state.me.rank}`)),
    ),
    h('details', { class: 'card' }, h('summary', {}, 'الترتيب'), standingsList(state.standings, { highlightId: state.me.id })),
    h('p', { class: 'hint center' }, state.isLastRound ? 'انتظر النتيجة النهائية…' : 'انتظر السؤال الجاي…'),
  );
}

function renderFinal() {
  const { me, isWinner, winners } = state;
  return h('main', { class: 'stage narrow final' },
    isWinner ? confetti() : null,
    h('div', { class: 'trophy' }, isWinner ? '🏆' : me.pinkCow ? '🐮' : '🎮'),
    h('h1', { class: 'center' }, isWinner ? 'أنت الفائز!' : 'انتهت اللعبة'),
    !isWinner && winners.length ? h('p', { class: 'center' }, 'الفائز: ', h('b', {}, winners.join(' و '))) : null,
    me.pinkCow && !isWinner ? h('div', { class: 'banner pink' }, 'خلصت اللعبة والبقرة الوردية معك، فما تقدر تفوز 😅') : null,
    h('div', { class: 'card score-card' },
      h('div', {}, h('small', {}, 'مجموعك'), h('b', {}, me.score)),
      h('div', {}, h('small', {}, 'ترتيبك'), h('b', {}, `#${me.rank}`)),
    ),
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}
