/* global $, h, range, toast, act, state, info, app, field, joinCard, gamePicker, kickButton, endGame, timerEl, standingsList, rulesList, confetti, GAME_NAME, MODES, categoryTag, lastVoteBanner, HOST_GAMES, sfx, sendToSite, banksBox, groupBox */
'use strict';

// Host screens for «عقلية القطيع».
(() => {
const TIMERS = [[0, 'بدون مؤقت'], [20, '20 ثانية'], [30, '30 ثانية'], [45, '45 ثانية'], [60, 'دقيقة'], [90, 'دقيقة ونص']];
let selectedGroup = null;

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


/* ---------- Lobby ---------- */


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
  const categories = h('div', { class: 'category-tree', role: 'group', 'aria-label': 'فئات الأسئلة' },
    state.categories.map((c) => h('div', { class: 'cat-row', 'data-category': c.id },
      h('div', { class: 'cat-head' },
        h('button', { type: 'button', class: 'category-chip', 'data-category': c.id, onclick: () => toggleCategory(c) },
          h('span', {}, c.emoji), h('span', {}, c.name), h('small', { class: 'category-count' })),
        h('button', {
          type: 'button',
          class: 'expand-btn',
          'aria-expanded': String(expanded.has(c.id)),
          onclick: () => toggleExpanded(c.id),
        }, expanded.has(c.id) ? 'إخفاء الأقسام ▴' : 'الأقسام ▾'),
      ),
      h('div', { class: 'sub-chips', hidden: !expanded.has(c.id) }, c.subcategories.map((sub) => h('button', {
        type: 'button',
        class: 'sub-chip',
        'data-sub': sub.id,
        onclick: () => toggleSub(sub.id),
      }, h('span', {}, sub.name), h('small', { class: 'category-count' })))),
    )));
  const custom = h('textarea', {
    id: 'custom',
    rows: 5,
    placeholder: 'اكتب كل سؤال في سطر\nمثال: اذكر لون من ألوان قوس قزح',
    value: s.customQuestions.join('\n'),
    onchange: (e) => act('host:settings', { customQuestions: e.target.value }),
  });

  return h('main', { class: 'lobby' },
    joinCard(),
    h('section', { class: 'card' },
      gamePicker(),
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
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setSubcategories(allSubIds()) }, 'الكل'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setSubcategories([]) }, 'ولا وحدة'),
          ),
          categories,
          h('p', { id: 'bank-size', class: 'hint' }),
        ),
        h('div', { class: 'field wide', id: 'custom-wrap', hidden: s.source === 'bank' },
          h('label', { class: 'field' }, h('span', {}, 'أسئلتك'), custom),
          h('div', { class: 'custom-share' },
            h('select', { id: 'herd-share-sub', 'aria-label': 'القسم' },
              h('option', { value: '' }, '📤 تبي ترسلها للموقع للكل؟ اختر قسمها…'),
              state.categories.flatMap((c) => c.subcategories.map((sub) => h('option', { value: sub.id }, `${c.emoji} ${c.name} · ${sub.name}`)))),
            h('button', {
              type: 'button',
              class: 'btn small',
              onclick: () => {
                const subcategory = $('#herd-share-sub').value;
                if (!subcategory) {
                  toast('اختر القسم أول');
                  return;
                }
                sendToSite('herd', state.settings.customQuestions.map((q) => ({ subcategory, mode: state.settings.mode, q })));
              },
            }, '📤 أرسل'),
          ),
          h('p', { class: 'hint' }, 'تنرسل بطور اللعبة المختار فوق، وتطلع للكل بعد موافقة صاحب الموقع.'),
        ),
      ),
      banksBox(),
      groupBox(),
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
    kickButton(p),
  )));
  if (!state.players.length) list.append(h('li', { class: 'empty' }, 'لسا ما أحد دخل… امسحوا الباركود'));
  $('#player-count').textContent = state.players.length;

  const { mode } = state.settings;
  document.querySelectorAll('.mode-option').forEach((el) => {
    const picked = el.dataset.mode === mode;
    el.classList.toggle('picked', picked);
    el.setAttribute('aria-checked', String(picked));
  });
  const picked = new Set(currentSubcategories());
  document.querySelectorAll('.cat-row').forEach((row) => {
    const category = state.categories.find((c) => c.id === row.dataset.category);
    const subs = category.subcategories;
    const count = subs.filter((sub) => picked.has(sub.id)).length;
    const chip = row.querySelector('.category-chip');
    chip.classList.toggle('picked', count === subs.length);
    chip.classList.toggle('partial', count > 0 && count < subs.length);
    chip.setAttribute('aria-pressed', count === subs.length ? 'true' : count ? 'mixed' : 'false');
    chip.querySelector('.category-count').textContent = count > 0 && count < subs.length
      ? `${count}/${subs.length}`
      : subs.reduce((total, sub) => total + sub.counts[mode], 0);
    row.querySelectorAll('.sub-chip').forEach((el) => {
      const sub = subs.find((x) => x.id === el.dataset.sub);
      el.classList.toggle('picked', picked.has(sub.id));
      el.setAttribute('aria-pressed', String(picked.has(sub.id)));
      el.querySelector('.category-count').textContent = sub.counts[mode];
    });
  });
  $('#bank-size').textContent = picked.size
    ? `${state.bankSize} سؤال من ${picked.size} ${picked.size === 1 ? 'قسم' : picked.size <= 10 ? 'أقسام' : 'قسم'} لطور «${MODES[mode].name}»`
    : 'اختر قسم واحد على الأقل';
  $('#rules-body').replaceChildren(rulesList(mode));

  const enough = state.players.length >= 2;
  $('#start').disabled = !enough;
  $('#start-hint').textContent = enough ? '' : 'تحتاجون لاعبين اثنين على الأقل';
}

// Taps apply locally right away and stay authoritative until the server
// confirms the latest one, so quick taps build on each other even while
// older updates are still coming back.
let pendingSubcategories = null;
let subcategoriesSeq = 0;
const expanded = new Set();

function allSubIds() {
  return state.categories.flatMap((c) => c.subcategories.map((sub) => sub.id));
}

function currentSubcategories() {
  return pendingSubcategories ?? state.settings.subcategories;
}

async function setSubcategories(subcategories) {
  pendingSubcategories = subcategories;
  const seq = ++subcategoriesSeq;
  updateLobby();
  await act('host:settings', { subcategories });
  if (seq === subcategoriesSeq) {
    pendingSubcategories = null;
    if (state.phase === 'lobby') updateLobby();
  }
}

/** A category tap picks all its subcategories, or clears them if all were picked. */
function toggleCategory(category) {
  const picked = new Set(currentSubcategories());
  const ids = category.subcategories.map((sub) => sub.id);
  const all = ids.every((id) => picked.has(id));
  for (const id of ids) {
    if (all) picked.delete(id);
    else picked.add(id);
  }
  setSubcategories([...picked]);
}

function toggleSub(id) {
  const picked = new Set(currentSubcategories());
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  setSubcategories([...picked]);
}

function toggleExpanded(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  const row = document.querySelector(`.cat-row[data-category="${id}"]`);
  row.querySelector('.sub-chips').hidden = !expanded.has(id);
  const button = row.querySelector('.expand-btn');
  button.setAttribute('aria-expanded', String(expanded.has(id)));
  button.textContent = expanded.has(id) ? 'إخفاء الأقسام ▴' : 'الأقسام ▾';
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




/* ---------- Question ---------- */

function renderQuestion() {
  return h('main', { class: 'stage' },
    modePill(),
    timerEl(state.endsAt),
    categoryTag(state.category),
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
      ? h('div', { class: 'card-actions' },
        h('button', {
          type: 'button',
          class: 'reject-btn',
          onclick: (e) => {
            e.stopPropagation();
            act('host:reject', { groupId: group.id });
          },
        }, group.rejected ? '↺ اقبله' : '🚫 رفض'),
        h('button', {
          type: 'button',
          class: 'vote-btn',
          title: 'خل اللاعبين يقررون',
          onclick: (e) => {
            e.stopPropagation();
            act('host:vote-start', { groupId: group.id });
          },
        }, '🗳️ تصويت'))
      : null,
    state.vote?.groupId === group.id ? h('div', { class: 'voting-label' }, '🗳️ عليه تصويت الحين') : null,
  );
}

function votePanel() {
  const { vote } = state;
  if (!vote) return null;
  if (vote.status === 'tie') {
    return h('div', { class: 'vote-panel tie' },
      h('h3', {}, `🗳️ تعادل على «${vote.text}»: ${vote.keep} يقبلونه و ${vote.reject} يرفضونه`),
      h('p', { class: 'muted' }, 'القرار لك:'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => act('host:vote-decide', { reject: false }) }, '✅ اقبله'),
        h('button', { class: 'btn danger', onclick: () => act('host:vote-decide', { reject: true }) }, '🚫 ارفضه'),
      ),
    );
  }
  return h('div', { class: 'vote-panel' },
    h('h3', {}, `🗳️ تصويت على «${vote.text}»`),
    h('p', { class: 'muted' }, `صوّت ${vote.votedCount} من ${vote.eligibleCount} · النتيجة تطلع لما يخلص التصويت`),
    h('ul', { class: 'chips center' }, vote.voters.map((p) => h('li', {
      class: `chip${p.voted ? ' done' : ''}${p.connected ? '' : ' away'}`,
    }, p.voted ? '✓ ' : '… ', p.name))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => act('host:vote-end') }, 'أنهِ التصويت'),
      h('button', { class: 'btn ghost', onclick: () => act('host:vote-cancel') }, 'إلغاء التصويت'),
    ),
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
  const voting = Boolean(state.vote);
  if (voting || !state.groups.some((g) => g.id === selectedGroup)) selectedGroup = null;
  let hint = 'جوابين بنفس المعنى؟ اضغط على وحدة ثم الثانية عشان تدمجهم. جواب غلط؟ «رفض»، ولو محتار «تصويت».';
  if (selectedGroup) hint = 'الحين اضغط على المجموعة الثانية عشان تندمج معها (أو اضغط نفسها للإلغاء)';
  return h('main', { class: 'stage' },
    modePill(),
    categoryTag(state.category),
    h('h2', { class: 'question small' }, state.question),
    votePanel(),
    lastVoteBanner(state.lastVote),
    voting ? null : h('p', { class: 'hint center' }, hint),
    state.groups.length
      ? h('div', { class: 'groups' }, state.groups.map((g) => groupCard(g, { editable: !voting })))
      : h('p', { class: 'empty center' }, 'ما أحد جاوب هالسؤال'),
    voting ? null : h('div', { class: 'actions' },
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

function render() {
  const screens = { lobby: renderLobby, question: renderQuestion, reveal: renderReveal, results: renderResults, final: renderFinal };
  app.replaceChildren(topbar(), screens[state.phase]());
}

function sounds(prev, next) {
  if (prev.phase === next.phase) return;
  if (next.phase === 'question') sfx.play('turn');
  else if (next.phase === 'reveal') sfx.play('reveal');
  else if (next.phase === 'results') sfx.play('correct');
}

HOST_GAMES.herd = { render, updateLobby, sounds };
})();
