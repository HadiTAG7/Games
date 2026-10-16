/* global $, h, range, emit, toast, socket, app, state, screenKey: writable, timerEl, standingsList, rulesList, confetti, GAME_NAME, MODES, categoryTag, lastVoteBanner, PLAY_GAMES */
'use strict';

// Player screens for «عقلية القطيع».
(() => {
let draft = { value: null, text: '' };
let draftRound = 0;
let editing = false;

function render() {
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

  // Only animate the screen the first time it appears, not on every update.
  const key = `${state.phase}:${state.roundNumber}`;
  app.classList.toggle('calm', screenKey === key);
  screenKey = key;
  const screens = { lobby: renderLobby, reveal: renderReveal, results: renderResults, final: renderFinal };
  app.replaceChildren(topbar(), screens[state.phase]());
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, `${GAME_NAME} ${MODES[state.mode].emoji}`),
    state.phase === 'question' || state.phase === 'reveal'
      ? h('div', { class: 'pill' }, `${state.roundNumber}/${state.totalRounds}`)
      : null,
    h('div', { class: 'pill' }, state.me.name, ' · ', h('b', {}, state.me.score)),
  );
}

function modePill() {
  const mode = MODES[state.mode];
  return h('div', { class: `mode-pill ${state.mode}` }, `${mode.emoji} ${mode.name}: ${mode.goal}`);
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
    modePill(),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), rulesList(state.mode)),
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
      modePill(),
      timerEl(state.endsAt),
      categoryTag(state.category),
      h('h1', { class: 'question' }, state.question),
      h('div', { class: 'step' }, h('span', { class: 'step-num' }, '1'), 'اختر رقم تراهن فيه'),
      bets,
      h('p', { class: 'hint' }, `كل رقم تستخدمه مرة وحدة · باقي لك ${state.maxBet - used.size} رقم`),
      h('div', { class: 'step' }, h('span', { class: 'step-num' }, '2'), MODES[state.mode].prompt),
      input,
      send,
      editing ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { editing = false; render(); } }, 'إلغاء التعديل') : null,
      h('p', { id: 'answered', class: 'muted center' }, answeredText()),
    ),
  );
}

function renderSent() {
  return h('main', { class: 'stage narrow' },
    modePill(),
    timerEl(state.endsAt),
    categoryTag(state.category),
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
  if (state.vote) return renderVote(state.vote);
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }),
    h('h2', { class: 'center' }, 'المضيف يراجع الأجوبة…'),
    h('h1', { class: 'question small' }, state.question),
    lastVoteBanner(state.lastVote),
    state.myAnswer
      ? h('div', { class: 'card center' }, 'جوابك: ', h('b', {}, state.myAnswer.text), ` · راهنت بـ ${state.myAnswer.value}`)
      : h('p', { class: 'muted center' }, 'ما لحقت تجاوب هالمرة'),
  );
}

function renderVote(vote) {
  const progress = h('p', { class: 'muted center' }, `صوّت ${vote.votedCount} من ${vote.eligibleCount}`);
  const header = [
    h('div', { class: 'vote-title' }, '🗳️ تصويت'),
    h('p', { class: 'muted center' }, state.question),
    h('div', { class: 'vote-answer' }, vote.text),
  ];
  if (vote.status === 'tie') {
    return h('main', { class: 'stage narrow' }, header, h('p', { class: 'center' }, 'تعادل! المضيف بيقرر…'));
  }
  if (vote.isAuthor) {
    return h('main', { class: 'stage narrow' }, header,
      h('div', { class: 'card center' }, 'هذا جوابك، الباقين يصوّتون عليه 🤞'), progress);
  }
  if (!vote.canVote) {
    return h('main', { class: 'stage narrow' }, header, h('p', { class: 'center' }, 'فيه تصويت على هالجواب، انتظر…'), progress);
  }
  const choose = async (choice) => {
    const res = await emit(socket, 'player:vote', { choice });
    if (!res.ok) toast(res.error);
  };
  return h('main', { class: 'stage narrow' }, header,
    h('p', { class: 'center' }, 'هل هذا جواب صحيح للسؤال؟'),
    h('div', { class: 'vote-choices' },
      h('button', {
        class: `btn big vote-choice keep${vote.myVote === 'keep' ? ' picked' : ''}`,
        'aria-pressed': String(vote.myVote === 'keep'),
        onclick: () => choose('keep'),
      }, '✅ صحيح، يُقبل'),
      h('button', {
        class: `btn big vote-choice reject${vote.myVote === 'reject' ? ' picked' : ''}`,
        'aria-pressed': String(vote.myVote === 'reject'),
        onclick: () => choose('reject'),
      }, '🚫 غلط، ينرفض'),
    ),
    vote.myVote ? h('p', { class: 'hint center' }, 'وصل صوتك، تقدر تغيّره لين يخلص التصويت') : null,
    progress,
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
      h('div', { class: 'big-emoji' }, state.mode === 'different' ? '🦄' : '🎉'),
      state.mode === 'different' ? 'ما أحد قال جوابك!' : 'فزت!',
      h('div', { class: 'points' }, `+${last.gained}`));
  }
  let reason = null;
  if (last.rejected) reason = 'المضيف رفض جوابك 🚫';
  else if (state.mode === 'different' && last.groupSize > 1) {
    reason = last.groupSize === 2 ? 'فيه واحد ثاني قال نفس جوابك' : `فيه ${last.groupSize - 1} غيرك قالوا نفس جوابك`;
  }
  return h('div', { class: 'verdict bad' }, h('div', { class: 'big-emoji' }, '😬'), `راحت عليك الـ ${last.value}`,
    reason ? h('div', { class: 'verdict-note' }, reason) : null);
}

function renderResults() {
  const mode = MODES[state.mode];
  const winners = state.groups.filter((g) => g.winner).map((g) => g.text);
  return h('main', { class: 'stage narrow' },
    verdict(state.last),
    h('p', { class: 'center' }, winners.length
      ? [`${mode.winnersTitle}: `, h('b', {}, winners.join(' / '))]
      : mode.noWinners),
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
    h('div', { class: 'trophy' }, isWinner ? '🏆' : '🎮'),
    h('h1', { class: 'center' }, isWinner ? 'أنت الفائز!' : 'انتهت اللعبة'),
    !isWinner && winners.length ? h('p', { class: 'center' }, 'الفائز: ', h('b', {}, winners.join(' و '))) : null,
    h('div', { class: 'card score-card' },
      h('div', {}, h('small', {}, 'مجموعك'), h('b', {}, me.score)),
      h('div', {}, h('small', {}, 'ترتيبك'), h('b', {}, `#${me.rank}`)),
    ),
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

PLAY_GAMES.herd = { render };
})();
