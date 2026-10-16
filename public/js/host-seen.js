/* global $, h, storage, toast, act, state, app, field, joinCard, gamePicker, endGame, confetti, HOST_GAMES, teamsSection,
   updateTeamsSection, timerEl, otherTeam, teamLabel, teamShort, SJ_LIFELINES, sjAnswering, sjScoreboard, sjBoard,
   sjQuestion, sjHead, sjResult, sjWinnerText, sjRulesList, sfx, customBox */
'use strict';

// Host screens for «سين جيم». The host picks the categories, taps the
// question a team chooses, sees the answer and judges.
(() => {
const BOARD_SIZE = 6;
const TURN_SECONDS = [30, 45, 60, 90];
const STEAL_SECONDS = [15, 20, 30];
const PREFS_KEY = 'sj:host-prefs';

let prefs = { answer: true, ...storage(PREFS_KEY) };
let busy = false;

function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  storage(PREFS_KEY, prefs);
  render();
}

/** Game actions carry the step they were pressed on, so the server ignores a double tap. */
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

/* ---------- Keyboard ---------- */

document.addEventListener('keydown', (e) => {
  if (!state || state.gameType !== 'seen' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const { phase } = state;
  let action = null;
  if (phase === 'picked' && (e.code === 'Space' || e.code === 'Enter')) action = ['host:sj-show'];
  else if ((phase === 'question' || phase === 'steal') && e.code === 'KeyC') action = ['host:sj-judge', { correct: true }];
  else if ((phase === 'question' || phase === 'steal') && e.code === 'KeyX') action = ['host:sj-judge', { correct: false }];
  else if (phase === 'reveal' && e.code === 'Enter') action = ['host:sj-next'];
  if (!action) return;
  e.preventDefault();
  send(...action);
});

/* ---------- Shared bits ---------- */

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'سين جيم ❓'),
    inGame ? h('div', { class: 'pill' }, `باقي ${state.tilesLeft} سؤال`) : null,
    h('div', { class: 'pill' }, 'الغرفة ', h('b', {}, state.code)),
  );
}

function answerBox(current) {
  const masked = !prefs.answer && state.phase !== 'reveal';
  return h('button', {
    type: 'button',
    class: `tc-answer${masked ? ' masked' : ''}`,
    title: masked ? 'اضغط عشان تشوف الجواب' : 'اضغط عشان تخفي الجواب (لو الشاشة قدام الكل)',
    onclick: () => { if (state.phase !== 'reveal') savePrefs({ answer: masked }); },
  },
    h('small', {}, masked ? '🙈 الجواب مخفي — اضغط عشان تشوفه' : 'الجواب'),
    h('b', {}, current.answer),
  );
}

function lifelineButton(name, { team, on = false }) {
  const info = SJ_LIFELINES[name];
  const left = state.lifelines[team].includes(name);
  return h('button', {
    type: 'button',
    class: `btn sj-life-btn${on ? ' on' : ''}`,
    disabled: !left && !on,
    'aria-pressed': String(on),
    title: info.hint,
    onclick: () => send('host:sj-lifeline', { name }),
  }, `${info.emoji} ${info.name}`, !left && !on ? h('small', {}, ' (انستخدمت)') : null);
}

/* ---------- Lobby ---------- */

let pendingCategories = null;
let categoriesSeq = 0;

function currentCategories() {
  return pendingCategories ?? state.settings.categories;
}

// Taps apply locally right away, so quick taps build on each other even
// while older updates are still coming back from the server.
async function setCategories(categories) {
  pendingCategories = categories;
  const seq = ++categoriesSeq;
  updateLobby();
  await act('host:settings', { categories });
  if (seq === categoriesSeq) {
    pendingCategories = null;
    if (state.phase === 'lobby' && state.gameType === 'seen') updateLobby();
  }
}

function toggleCategory(id) {
  const picked = currentCategories();
  if (picked.includes(id)) setCategories(picked.filter((c) => c !== id));
  else if (picked.length >= BOARD_SIZE) toast(`اخترت ${BOARD_SIZE} فئات، شيل وحدة أول`);
  else setCategories([...picked, id]);
}

function categoryChips() {
  return state.categories.map((c) => h('button', {
    type: 'button',
    class: `category-chip${c.id === 'custom' ? ' custom' : ''}`,
    'data-category': c.id,
    onclick: () => toggleCategory(c.id),
  }, h('span', {}, c.emoji), h('span', {}, c.name), h('small', { class: 'category-count' }, c.count)));
}

function renderLobby() {
  const s = state.settings;
  const select = (id, key, options, value) => h('select', {
    id,
    onchange: (e) => act('host:settings', { [key]: Number(e.target.value) }),
  }, options.map((n) => h('option', { value: n, selected: n === value }, `${n} ثانية`)));

  return h('main', { class: 'lobby' },
    joinCard(),
    h('section', { class: 'card' },
      gamePicker(),
      teamsSection(),
      h('h2', {}, 'الإعدادات'),
      h('div', { class: 'settings' },
        field('وقت الفريق اللي عليه الدور', select('sj-turn', 'turnSeconds', TURN_SECONDS, s.turnSeconds)),
        field('وقت الفرصة للفريق الثاني', select('sj-steal', 'stealSeconds', STEAL_SECONDS, s.stealSeconds)),
        h('div', { class: 'field wide' },
          h('div', { class: 'field-head' },
            h('span', {}, 'الفئات: ', h('b', { id: 'sj-category-count' })),
            h('button', {
              type: 'button',
              class: 'link-btn small',
              onclick: async () => {
                pendingCategories = null;
                categoriesSeq += 1;
                await act('host:settings', { randomCategories: true });
              },
            }, '🎲 اختيار عشوائي'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories([]) }, 'ولا وحدة'),
          ),
          h('div', { class: 'chips sj-categories', role: 'group', 'aria-label': 'الفئات' }, categoryChips()),
        ),
      ),
      customBox({
        game: 'seen',
        open: Boolean(state.custom.text),
        help: 'فئة خاصة فيكم تطلع مع الفئات. كل سطر: القيمة | السؤال | الجواب، مثل: 200 | مين أطول واحد فينا؟ | فهد. وتحتاج سؤالين على الأقل من كل قيمة.',
        inputs: [
          h('div', { class: 'settings' },
            field('اسم الفئة', h('input', { id: 'sj-custom-name', maxlength: 30, value: state.custom.name, placeholder: 'أسئلتنا' })),
            field('إيموجي', h('input', { id: 'sj-custom-emoji', maxlength: 8, value: state.custom.emoji, placeholder: '✍️' }))),
          h('textarea', { id: 'sj-custom-text', rows: 5, value: state.custom.text, placeholder: '200 | السؤال | الجواب\n400 | السؤال | الجواب\n600 | السؤال | الجواب' }),
        ],
        save: () => act('host:settings', { custom: { name: $('#sj-custom-name').value, emoji: $('#sj-custom-emoji').value, text: $('#sj-custom-text').value } }),
        items: () => state.custom.items.map((i) => ({ category: '__new', newName: state.custom.name, newEmoji: state.custom.emoji, value: i.value, q: i.q, a: i.a })),
      }),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: () => send('host:start') }, 'ابدأ اللعبة ❓'),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  updateTeamsSection();
  // The host's own category comes and goes, so redraw the chips when the list changes.
  const box = $('.sj-categories');
  const shown = [...box.children].map((el) => `${el.dataset.category}:${el.textContent}`).join('|');
  const fresh = categoryChips();
  if (fresh.map((el) => `${el.dataset.category}:${el.textContent}`).join('|') !== shown) box.replaceChildren(...fresh);
  const picked = currentCategories();
  document.querySelectorAll('.sj-categories .category-chip').forEach((el) => {
    const n = picked.indexOf(el.dataset.category);
    el.classList.toggle('picked', n >= 0);
    el.classList.toggle('full', n < 0 && picked.length >= BOARD_SIZE);
    el.setAttribute('aria-pressed', String(n >= 0));
  });
  $('#sj-category-count').textContent = `اخترت ${picked.length} من ${BOARD_SIZE}`;
  $('#rules-body').replaceChildren(sjRulesList(state.settings));
  const { custom } = state;
  const per = [200, 400, 600].map((v) => `${v}: ${custom.items.filter((i) => i.value === v).length}`).join('، ');
  $('#custom-status').textContent = custom.items.length
    ? `${custom.items.length} سؤال (${per})${custom.bad ? ` · ${custom.bad} سطر ما فهمناه` : ''} · ${custom.ready ? '✅ الفئة جاهزة، اخترها من الفئات فوق' : 'تحتاج سؤالين من كل قيمة'}`
    : '';

  const teamsReady = state.teams.red.length > 0 && state.teams.blue.length > 0;
  $('#start').disabled = !teamsReady || picked.length !== BOARD_SIZE;
  let hint = '';
  if (!state.players.length) hint = 'امسحوا الباركود وادخلوا، واللعبة تقسمكم فريقين';
  else if (!teamsReady) hint = 'كل فريق يحتاج لاعب واحد على الأقل';
  else if (picked.length !== BOARD_SIZE) hint = `اختر ${BOARD_SIZE} فئات`;
  $('#start-hint').textContent = hint;
}

/* ---------- Board ---------- */

function renderBoard() {
  return h('main', { class: 'stage sj-stage' },
    sjScoreboard(state),
    h('div', { class: `sj-turn ${state.turn}` }, `دور ${teamLabel(state.turn)}: اختاروا سؤال`),
    sjBoard(state, { onPick: (tile) => send('host:sj-pick', { tileId: tile.id }) }),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة')),
  );
}

/* ---------- A question ---------- */

function renderPicked() {
  const { current } = state;
  return h('main', { class: 'stage sj-stage narrow' },
    sjScoreboard(state, { compact: true }),
    h('div', { class: `sj-picked ${current.team}` },
      h('div', { class: 'sj-picked-cat' }, `${current.category.emoji} ${current.category.name}`),
      h('div', { class: 'sj-picked-value' }, current.value),
      h('div', {}, teamLabel(current.team)),
    ),
    h('p', { class: 'center' }, 'تبون تستخدمون وسيلة قبل ما يطلع السؤال؟'),
    h('div', { class: 'sj-life-row' },
      ['pit', 'double'].map((name) => lifelineButton(name, { team: current.team, on: current.before.includes(name) }))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big tc-main-btn', onclick: () => send('host:sj-show') }, 'اعرض السؤال ▶️'),
      h('button', { class: 'btn ghost', onclick: () => send('host:sj-cancel') }, '↩︎ اختاروا سؤال ثاني'),
    ),
    h('p', { class: 'hint center kbd-hint' }, 'مسافة = اعرض السؤال'),
  );
}

function renderQuestion() {
  const { current, phase } = state;
  const steal = phase === 'steal';
  const team = sjAnswering(state);
  const calling = current.during.includes('call') && !steal;
  return h('main', { class: 'stage sj-stage' },
    sjScoreboard(state, { compact: true }),
    sjHead(current),
    h('div', { class: `sj-turn ${team}` },
      steal ? `فرصة ${teamLabel(team)} يسرق النقاط!` : calling ? `📞 ${teamLabel(team)} يتصل بصديق` : `${teamLabel(team)} يجاوب`,
      timerEl(current.endsAt)),
    sjQuestion(current),
    answerBox(current),
    steal ? null : h('div', { class: 'sj-life-row' },
      ['two', 'call'].map((name) => lifelineButton(name, { team: current.team, on: current.during.includes(name) }))),
    h('div', { class: 'tc-judge' },
      h('button', { class: 'btn tc-correct', onclick: () => send('host:sj-judge', { correct: true }) },
        steal ? `✅ صح لـ${teamShort(team)}` : '✅ صح'),
      h('button', { class: 'btn tc-skip', onclick: () => send('host:sj-judge', { correct: false }) },
        steal ? '❌ محد جاوب' : '❌ غلط'),
    ),
    h('div', { class: 'actions tc-tools' },
      state.canUndo ? h('button', { class: 'btn', onclick: () => send('host:sj-undo') }, '↩︎ تراجع') : null,
      h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
    h('p', { class: 'hint center kbd-hint' }, 'الكيبورد: C = صح · X = غلط'),
  );
}

function renderReveal() {
  const { current } = state;
  const last = state.tilesLeft === 0;
  return h('main', { class: 'stage sj-stage' },
    sjResult(current),
    sjScoreboard(state, { compact: true }),
    sjHead(current),
    sjQuestion(current),
    answerBox(current),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big tc-main-btn', onclick: () => send('host:sj-next') },
        last ? 'النتيجة النهائية 🏆' : 'رجوع للوحة ▶️'),
      h('button', { class: 'btn', onclick: () => send('host:sj-undo') }, '↩︎ تراجع عن الحكم'),
    ),
    h('p', { class: 'hint center kbd-hint' }, 'Enter = رجوع للوحة'),
  );
}

function renderFinal() {
  const { winner } = state;
  return h('main', { class: 'stage narrow final' },
    winner ? confetti() : null,
    h('div', { class: 'trophy' }, winner ? '🏆' : '🤝'),
    h('h1', { class: 'winner-name' }, sjWinnerText(state)),
    winner && state.teams[winner].length ? h('p', { class: 'center' }, state.teams[winner].map((p) => p.name).join(' · ')) : null,
    sjScoreboard(state),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => act('host:restart') }, 'لعبة جديدة 🔁')),
    h('p', { class: 'hint center' }, 'الفريق الثاني يبدأ اللعبة الجاية، والأسئلة ما تتكرر'),
  );
}

/* ---------- Render ---------- */

const SCREENS = {
  board: renderBoard,
  picked: renderPicked,
  question: renderQuestion,
  steal: renderQuestion,
  reveal: renderReveal,
  final: renderFinal,
};

function render() {
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  // Redraw only when something on screen changed (not when a phone reconnects).
  const key = JSON.stringify([state.phase, state.step, state.score, state.lifelines, state.current, state.canUndo,
    state.phase === 'final' && state.teams, prefs]);
  if ($('#sj-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'sj-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

function sounds(prev, next) {
  if (prev.step === next.step && prev.phase === next.phase) return;
  if (prev.phase === 'board' && next.phase === 'picked') sfx.play('turn');
  else if (prev.phase === 'picked' && next.phase === 'question') sfx.play('reveal');
  else if (prev.phase === 'question' && next.phase === 'steal') sfx.play('steal');
  else if (next.phase === 'reveal' && prev.phase !== 'reveal') sfx.play(next.current?.result?.winner ? 'correct' : 'wrong');
}

HOST_GAMES.seen = { render, updateLobby, sounds };
})();
