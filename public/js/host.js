/* global io, $, h, range, emit, storage, toast, connectionBanner, syncClock, timerEl, standingsList, rulesList, confetti, GAME_NAME, MODES */
'use strict';

const socket = io();
const app = $('#app');
const SESSION_KEY = 'herd:host';
const TIMERS = [[0, 'بدون مؤقت'], [20, '20 ثانية'], [30, '30 ثانية'], [45, '45 ثانية'], [60, 'دقيقة'], [90, 'دقيقة ونص']];

let state = null;
let info = null; // { code, hostToken, joinUrl, qrSvg }
let renderedPhase = null;
let selectedGroup = null;
let forceNew = new URLSearchParams(location.search).has('new');
if (forceNew) history.replaceState(null, '', location.pathname);

connectionBanner(socket);

socket.on('connect', async () => {
  const saved = forceNew ? null : storage(SESSION_KEY);
  let res = saved ? await emit(socket, 'host:resume', saved) : null;
  if (!res || !res.ok) res = await emit(socket, 'host:create');
  forceNew = false;
  if (!res.ok) {
    toast(res.error);
    return;
  }
  if (!info || info.code !== res.code) renderedPhase = null;
  info = res;
  storage(SESSION_KEY, { code: res.code, hostToken: res.hostToken });
  render();
});

socket.on('host:state', (next) => {
  state = next;
  syncClock(next.serverTime);
  render();
});

async function act(event, payload) {
  const res = await emit(socket, event, payload);
  if (!res.ok) toast(res.error);
  return res;
}

function render() {
  if (!state || !info || state.code !== info.code) return;
  // The lobby holds form fields, so keep it and only refresh the player list.
  if (state.phase === 'lobby' && renderedPhase === 'lobby') {
    updateLobby();
    return;
  }
  renderedPhase = state.phase;
  const screens = { lobby: renderLobby, question: renderQuestion, reveal: renderReveal, results: renderResults, final: renderFinal };
  app.replaceChildren(topbar(), screens[state.phase]());
  if (state.phase === 'lobby') updateLobby();
}

function topbar() {
  const playing = state.phase !== 'lobby' && state.phase !== 'final';
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, `${GAME_NAME} ${MODES[state.mode].emoji}`),
    playing ? h('div', { class: 'pill' }, `سؤال ${state.roundNumber} من ${state.totalRounds}`) : null,
    h('div', { class: 'pill' }, 'الغرفة ', h('b', {}, state.code)),
  );
}

function modePill() {
  const mode = MODES[state.mode];
  return h('div', { class: `mode-pill ${state.mode}` }, `${mode.emoji} ${mode.name}: ${mode.goal}`);
}

function categoryTag() {
  return state.category ? h('div', { class: 'category-tag' }, `${state.category.emoji} ${state.category.name}`) : null;
}

/* ---------- Lobby ---------- */

function field(label, control) {
  return h('label', { class: 'field' }, h('span', {}, label), control);
}

function renderLobby() {
  const s = state.settings;
  const modePicker = h('div', { class: 'mode-picker', role: 'radiogroup', 'aria-label': 'طور اللعبة' },
    Object.entries(MODES).map(([key, mode]) => h('button', {
      type: 'button',
      class: 'mode-option',
      'data-mode': key,
      role: 'radio',
      onclick: () => act('host:settings', { mode: key }),
    }, h('span', { class: 'mode-emoji' }, mode.emoji), h('b', {}, mode.name), h('small', {}, mode.goal))));
  const rounds = h('select', { id: 'rounds', onchange: (e) => act('host:settings', { rounds: Number(e.target.value) }) },
    range(3, 15).map((n) => h('option', { value: n, selected: n === s.rounds }, `${n} ${n <= 10 ? 'أسئلة' : 'سؤال'}`)));
  const timer = h('select', { id: 'timer', onchange: (e) => act('host:settings', { timer: Number(e.target.value) }) },
    TIMERS.map(([value, label]) => h('option', { value, selected: value === s.timer }, label)));
  const source = h('select', {
    id: 'source',
    onchange: (e) => {
      $('#custom-wrap').hidden = e.target.value === 'bank';
      $('#categories-wrap').hidden = e.target.value === 'custom';
      act('host:settings', { source: e.target.value });
    },
  }, [['bank', 'بنك الأسئلة'], ['custom', 'أسئلتي أنا'], ['mix', 'أسئلتي + بنك الأسئلة']]
    .map(([value, label]) => h('option', { value, selected: value === s.source }, label)));
  const categories = h('div', { class: 'category-picker', role: 'group', 'aria-label': 'فئات الأسئلة' },
    state.categories.map((c) => h('button', {
      type: 'button',
      class: 'category-chip',
      'data-category': c.id,
      onclick: () => toggleCategory(c.id),
    }, h('span', {}, c.emoji), h('span', {}, c.name), h('small', { class: 'category-count' }))));
  const custom = h('textarea', {
    id: 'custom',
    rows: 5,
    placeholder: 'اكتب كل سؤال في سطر\nمثال: اذكر لون من ألوان قوس قزح',
    value: s.customQuestions.join('\n'),
    onchange: (e) => act('host:settings', { customQuestions: e.target.value }),
  });

  return h('main', { class: 'lobby' },
    h('section', { class: 'card join-card' },
      h('h2', {}, 'امسحوا الباركود وادخلوا 📱'),
      h('div', { class: 'qr', html: info.qrSvg }),
      h('div', { class: 'big-code' }, h('small', {}, 'أو ادخلوا برقم الغرفة'), h('b', {}, state.code)),
      h('button', { class: 'link-btn', title: 'نسخ الرابط', onclick: copyLink }, info.joinUrl),
    ),
    h('section', { class: 'card' },
      h('h2', {}, 'اللاعبين ', h('span', { id: 'player-count', class: 'count' })),
      h('ul', { id: 'players', class: 'chips' }),
      h('h2', {}, 'طور اللعبة'),
      modePicker,
      h('h2', {}, 'الإعدادات'),
      h('div', { class: 'settings' },
        field('عدد الأسئلة', rounds),
        field('المؤقت', timer),
        h('label', { class: 'field wide' }, h('span', {}, 'الأسئلة'), source),
        h('div', { class: 'field wide', id: 'categories-wrap', hidden: s.source === 'custom' },
          h('div', { class: 'field-head' },
            h('span', {}, 'الفئات'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories(state.categories.map((c) => c.id)) }, 'الكل'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories([]) }, 'ولا وحدة'),
          ),
          categories,
          h('p', { id: 'bank-size', class: 'hint' }),
        ),
        h('label', { class: 'field wide', id: 'custom-wrap', hidden: s.source === 'bank' }, h('span', {}, 'أسئلتك'), custom),
      ),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: startGame }, 'ابدأ اللعبة 🎉'),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  const list = $('#players');
  list.replaceChildren(...state.players.map((p) => h('li', { class: `chip${p.connected ? '' : ' away'}` },
    h('span', {}, p.name),
    h('button', { class: 'x', title: `طرد ${p.name}`, 'aria-label': `طرد ${p.name}`, onclick: () => kick(p) }, '×'),
  )));
  if (!state.players.length) list.append(h('li', { class: 'empty' }, 'لسا ما أحد دخل… امسحوا الباركود'));
  $('#player-count').textContent = state.players.length;

  const { mode } = state.settings;
  document.querySelectorAll('.mode-option').forEach((el) => {
    const picked = el.dataset.mode === mode;
    el.classList.toggle('picked', picked);
    el.setAttribute('aria-checked', String(picked));
  });
  const picked = new Set(state.settings.categories);
  document.querySelectorAll('.category-chip').forEach((el) => {
    const category = state.categories.find((c) => c.id === el.dataset.category);
    el.classList.toggle('picked', picked.has(category.id));
    el.setAttribute('aria-pressed', String(picked.has(category.id)));
    el.querySelector('.category-count').textContent = category.counts[mode];
  });
  $('#bank-size').textContent = picked.size
    ? `${state.bankSize} سؤال من ${picked.size} ${picked.size === 1 ? 'فئة' : 'فئات'} لطور «${MODES[mode].name}»`
    : 'اختر فئة وحدة على الأقل';
  $('#rules-body').replaceChildren(rulesList(mode));

  const enough = state.players.length >= 2;
  $('#start').disabled = !enough;
  $('#start-hint').textContent = enough ? '' : 'تحتاجون لاعبين اثنين على الأقل';
}

function setCategories(categories) {
  // Update locally first so quick taps build on each other before the server replies.
  state.settings = { ...state.settings, categories };
  updateLobby();
  act('host:settings', { categories });
}

function toggleCategory(id) {
  const picked = new Set(state.settings.categories);
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  setCategories([...picked]);
}

async function startGame() {
  // Send the latest form values first; the textarea only reports on blur.
  const res = await act('host:settings', {
    rounds: Number($('#rounds').value),
    timer: Number($('#timer').value),
    source: $('#source').value,
    customQuestions: $('#custom').value,
  });
  if (res.ok) act('host:start');
}

function kick(player) {
  if (confirm(`تطرد ${player.name} من الغرفة؟`)) act('host:kick', { playerId: player.id });
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(info.joinUrl);
    toast('انتسخ الرابط', 'ok');
  } catch {
    toast(info.joinUrl, 'ok');
  }
}

function endGame() {
  if (confirm('تنهي اللعبة الحين وتطلع النتيجة النهائية؟')) act('host:end');
}

/* ---------- Question ---------- */

function renderQuestion() {
  return h('main', { class: 'stage' },
    modePill(),
    timerEl(state.endsAt),
    categoryTag(),
    h('h1', { class: 'question' }, state.question),
    h('p', { class: 'muted center' }, `جاوب ${state.answeredCount} من ${state.playerCount}`),
    h('ul', { class: 'chips center' }, state.players.map((p) => h('li', {
      class: `chip${p.answered ? ' done' : ''}${p.connected ? '' : ' away'}`,
    }, p.answered ? '✓ ' : '… ', p.name))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => act('host:reveal') }, 'اكشف الأجوبة 👀'),
      h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
  );
}

/* ---------- Reveal & results ---------- */

function groupCard(group, { editable = false, settled = false } = {}) {
  const classes = ['group'];
  if (group.winner) classes.push('winner');
  if (group.rejected) classes.push('rejected');
  if (editable) classes.push('editable');
  if (group.id === selectedGroup) classes.push('selected');
  const select = () => onGroupClick(group.id);
  return h('div', {
    class: classes.join(' '),
    role: editable ? 'button' : null,
    tabindex: editable ? 0 : null,
    onclick: editable ? select : null,
    onkeydown: editable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } : null,
  },
    h('div', { class: 'group-head' },
      h('span', { class: 'group-text' }, group.text),
      h('span', { class: 'size', title: 'عدد اللي جاوبوا' }, group.size),
    ),
    h('ul', { class: 'members' }, group.members.map((m) => h('li', {},
      h('span', { class: 'member-name' }, m.name),
      m.text !== group.text ? h('em', { class: 'member-text' }, m.text) : null,
      h('span', { class: `bet${settled ? (group.winner ? ' won' : ' lost') : ''}` },
        settled && group.winner ? `+${m.value}` : m.value),
    ))),
    group.winner ? h('div', { class: 'crown' }, MODES[state.mode].winLabel) : null,
    group.rejected ? h('div', { class: 'rejected-label' }, '🚫 مرفوض') : null,
    editable
      ? h('button', {
        type: 'button',
        class: 'reject-btn',
        onclick: (e) => {
          e.stopPropagation();
          act('host:reject', { groupId: group.id });
        },
      }, group.rejected ? '↺ اقبله' : '🚫 رفض')
      : null,
  );
}

function onGroupClick(id) {
  if (!selectedGroup || selectedGroup === id) {
    selectedGroup = selectedGroup === id ? null : id;
    render();
    return;
  }
  const to = selectedGroup;
  selectedGroup = null;
  act('host:merge', { from: id, to }).then((res) => { if (!res.ok) render(); });
}

function renderReveal() {
  if (!state.groups.some((g) => g.id === selectedGroup)) selectedGroup = null;
  const hint = selectedGroup
    ? 'الحين اضغط على المجموعة الثانية عشان تندمج معها (أو اضغط نفسها للإلغاء)'
    : 'جوابين بنفس المعنى؟ اضغط على وحدة ثم الثانية عشان تدمجهم. وأي جواب غلط اضغط «رفض».';
  return h('main', { class: 'stage' },
    modePill(),
    categoryTag(),
    h('h2', { class: 'question small' }, state.question),
    h('p', { class: 'hint center' }, hint),
    state.groups.length
      ? h('div', { class: 'groups' }, state.groups.map((g) => groupCard(g, { editable: true })))
      : h('p', { class: 'empty center' }, 'ما أحد جاوب هالسؤال'),
    h('div', { class: 'actions' },
      state.canUndo ? h('button', { class: 'btn ghost', onclick: () => act('host:undo') }, '↩︎ تراجع') : null,
      h('button', { class: 'btn primary', onclick: () => act('host:confirm') }, 'اعتمد النتيجة ✅'),
    ),
  );
}

function renderResults() {
  const mode = MODES[state.mode];
  const winners = state.groups.filter((g) => g.winner);
  return h('main', { class: 'stage' },
    h('h2', { class: 'question small' }, state.question),
    winners.length
      ? h('div', { class: 'banner good' }, `${mode.winnersTitle}: `, h('b', {}, winners.map((g) => g.text).join(' / ')))
      : h('div', { class: 'banner bad' }, mode.noWinners),
    h('div', { class: 'groups' }, state.groups.map((g) => groupCard(g, { settled: true }))),
    state.missed.length
      ? h('p', { class: 'muted center missed' }, '⌛ ما جاوبوا: ',
        state.missed.map((m) => `${m.name} (انحرق ${m.value})`).join('، '))
      : null,
    h('h2', { class: 'center' }, 'الترتيب'),
    standingsList(state.standings),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => act('host:next') },
        state.isLastRound ? 'النتيجة النهائية 🏆' : 'السؤال التالي ⬅︎'),
      state.isLastRound ? null : h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
  );
}

/* ---------- Final ---------- */

function renderFinal() {
  const { winners } = state;
  return h('main', { class: 'stage final' },
    confetti(),
    h('div', { class: 'trophy' }, '🏆'),
    winners.length ? h('h1', { class: 'winner-name' }, winners.join(' و ')) : null,
    winners.length ? h('p', { class: 'muted center' }, `بـ ${state.standings[0].score} نقطة`) : null,
    standingsList(state.standings, { showGain: false }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => act('host:restart') }, 'لعبة جديدة 🔁'),
    ),
  );
}
