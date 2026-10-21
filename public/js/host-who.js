/* global $, h, act, state, app, field, joinCard, gamePicker, kickButton, endGame, confetti, timerEl, standingsList, pointsText,
   HOST_GAMES, sfx, whoRulesList, whoRoundTitle, whoTally, whoVerdict, whoTitles, banksBox, groupBox, icon */
'use strict';

// Host screens for «مين فينا؟». The screen is for everyone, so it shows how
// many have voted and then how many votes each one got, never who voted for whom.
(() => {
let busy = false;
let pendingCategories = null; // the host's latest category picks, ahead of the server's echo

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

/* ---------- Keyboard: Space moves things along ---------- */

document.addEventListener('keydown', (e) => {
  if (!state || state.gameType !== 'who' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, button')) return;
  if (e.code !== 'Space') return;
  if (state.phase === 'question' && state.round.votedCount) send('host:who-reveal');
  else if (state.phase === 'reveal') send('host:next');
  else return;
  e.preventDefault();
});

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'مين فينا؟ ', icon('pointer')),
    inGame ? h('div', { class: 'pill' }, whoRoundTitle(state.round)) : null,
    h('div', { class: 'pill' }, 'الغرفة ', h('b', {}, state.code)),
  );
}

/* ---------- Lobby ---------- */

function currentCategories() {
  return pendingCategories ?? state.settings.categories;
}

async function setCategories(categories) {
  pendingCategories = categories;
  updateLobby();
  await act('host:settings', { categories });
  if (pendingCategories === categories) pendingCategories = null;
}

function toggleCategory(id) {
  const picked = currentCategories();
  setCategories(picked.includes(id) ? picked.filter((c) => c !== id) : [...picked, id]);
}

function showSource(source) {
  $('#who-categories-wrap').hidden = source === 'custom';
  $('#who-custom-wrap').hidden = source === 'bank';
}

function renderLobby() {
  const s = state.settings;
  const select = (id, key, options, parse = Number) => h('select', { id, onchange: (e) => act('host:settings', { [key]: parse(e.target.value) }) },
    options.map(([value, label]) => h('option', { value, selected: value === s[key] }, label)));
  return h('main', { class: 'lobby' },
    joinCard(),
    h('section', { class: 'card' },
      gamePicker(),
      h('h2', {}, 'اللاعبين ', h('span', { id: 'player-count', class: 'count' })),
      h('ul', { id: 'players', class: 'chips' }),
      h('h2', {}, 'الإعدادات'),
      h('div', { class: 'settings' },
        field('عدد الأسئلة', select('who-rounds', 'rounds', state.roundsOptions.map((n) => [n, `${n} أسئلة`]))),
        field('وقت التصويت', select('who-timer', 'timer', state.timerOptions.map((n) => [n, n ? `${n} ثانية` : 'بدون مؤقت']))),
        h('label', { class: 'field wide' }, h('span', {}, 'الأسئلة'), h('select', {
          id: 'who-source',
          onchange: (e) => {
            showSource(e.target.value);
            act('host:settings', { source: e.target.value });
          },
        }, [['bank', 'بنك الأسئلة'], ['custom', 'أسئلتي أنا'], ['mix', 'أسئلتي + بنك الأسئلة']]
          .map(([value, label]) => h('option', { value, selected: value === s.source }, label)))),
        h('div', { class: 'field wide', id: 'who-categories-wrap', hidden: s.source === 'custom' },
          h('div', { class: 'field-head' },
            h('span', {}, 'الفئات: ', h('b', { id: 'who-category-count' })),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories(state.categories.map((c) => c.id)) }, 'الكل'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories([]) }, 'ولا وحدة'),
          ),
          h('div', { class: 'chips who-categories', role: 'group', 'aria-label': 'الفئات' }, state.categories.map((c) => h('button', {
            type: 'button',
            class: 'category-chip',
            'data-category': c.id,
            onclick: () => toggleCategory(c.id),
          }, h('span', {}, c.name), h('small', { class: 'category-count' }, c.count)))),
        ),
        h('div', { class: 'field wide', id: 'who-custom-wrap', hidden: s.source === 'bank' },
          h('label', { class: 'field' }, h('span', {}, 'أسئلتكم'), h('textarea', {
            id: 'who-custom',
            rows: 5,
            value: state.custom.text,
            placeholder: 'كل سؤال في سطر\nمين أكثر واحد يتأخر على الدوام؟\nمين أكثر واحد يحب البر؟',
            onchange: (e) => act('host:settings', { customQuestions: e.target.value }),
          })),
          h('p', { class: 'hint', id: 'who-custom-status' }),
        ),
      ),
      banksBox(),
      groupBox(),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: startGame }, 'ابدأ اللعبة ', icon('pointer')),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

async function startGame() {
  // The textarea only reports on blur: send what's typed first.
  const res = await act('host:settings', { customQuestions: $('#who-custom').value });
  if (res.ok) send('host:start');
}

function updateLobby() {
  const s = state.settings;
  const list = $('#players');
  list.replaceChildren(...state.players.map((p) => h('li', { class: `chip${p.connected ? '' : ' away'}` }, h('span', {}, p.name), kickButton(p))));
  if (!state.players.length) list.append(h('li', { class: 'empty' }, 'لسا ما أحد دخل… امسحوا الباركود'));
  $('#player-count').textContent = state.players.length;
  const picked = currentCategories();
  document.querySelectorAll('.who-categories .category-chip').forEach((el) => {
    const on = picked.includes(el.dataset.category);
    el.classList.toggle('picked', on);
    el.setAttribute('aria-pressed', String(on));
  });
  $('#who-category-count').textContent = `اخترت ${picked.length} من ${state.categories.length}`;
  if (document.activeElement?.id !== 'who-source') $('#who-source').value = s.source;
  showSource($('#who-source').value);
  const { custom } = state;
  $('#who-custom-status').textContent = custom.count ? `${custom.count} سؤال (أكثر شي ${custom.max})` : '';
  $('#rules-body').replaceChildren(whoRulesList(s, state.rules));
  const enough = state.players.length >= state.rules.minPlayers;
  const noQuestions = s.source === 'custom' ? !custom.count : s.source === 'bank' && !picked.length;
  $('#start').disabled = !enough || noQuestions;
  let hint = '';
  if (!enough) hint = `تحتاجون ${state.rules.minPlayers} لاعبين على الأقل (دخل ${state.players.length})`;
  else if (noQuestions) hint = s.source === 'custom' ? 'اكتب سؤال واحد على الأقل واضغط برا المربع' : 'اختر فئة وحدة على الأقل';
  $('#start-hint').textContent = hint;
}

/* ---------- A question ---------- */

function renderQuestion() {
  const { round } = state;
  return h('main', { class: 'stage narrow who-stage' },
    round.category ? h('div', { class: 'category-tag' }, round.category) : null,
    timerEl(round.endsAt),
    h('h1', { class: 'question who-question' }, round.question),
    h('div', { class: 'who-progress' },
      h('div', { class: 'who-progress-bar' }, h('span', { style: `width:${(round.votedCount / Math.max(1, round.voterCount)) * 100}%` })),
      h('p', { class: 'center' }, h('b', { 'data-bump': 'who-voted' }, `${round.votedCount} من ${round.voterCount}`), ' صوّتوا'),
    ),
    h('p', { class: 'hint center' }, icon('smartphone'), ' صوّتوا من جوالاتكم بالسر، وتنكشف الأصوات لما الكل يصوّت'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', disabled: !round.votedCount, onclick: () => send('host:who-reveal') }, 'اكشف الأصوات ', icon('eye')),
      h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
  );
}

function renderReveal() {
  const { round } = state;
  const { result } = round;
  const last = round.number >= round.total;
  return h('main', { class: 'stage narrow who-stage' },
    h('p', { class: 'who-asked' }, round.question),
    whoVerdict(result),
    whoTally(result),
    result.top.length
      ? h('p', { class: 'center muted' }, result.guessedCount
        ? `${result.guessedCount} خمّنوا الأغلبية، وكل واحد منهم أخذ ${pointsText(state.rules.point)}`
        : 'محد خمّن الأغلبية هالمرة')
      : null,
    h('h2', { class: 'center' }, 'الترتيب'),
    standingsList(state.standings, { showGain: false }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => send('host:next') }, last ? ['النتيجة النهائية ', icon('trophy')] : ['السؤال الجاي ', icon('play')]),
      last ? null : h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
  );
}

function renderFinal() {
  const top = state.standings.filter((r) => r.rank === 1 && r.score > 0);
  const titles = whoTitles(state.titles);
  return h('main', { class: 'stage narrow final' },
    top.length ? confetti() : null,
    h('div', { class: 'trophy' }, top.length ? icon('trophy') : icon('handshake')),
    h('h1', { class: 'winner-name' }, top.length ? top.map((r) => r.name).join(' و') : 'محد كسب نقاط'),
    top.length ? h('p', { class: 'muted center' }, `خمّن الأغلبية ${top[0].score} ${top[0].score === 1 ? 'مرة' : 'مرات'}`) : null,
    standingsList(state.standings, { showGain: false }),
    titles ? [h('h2', { class: 'center' }, 'ألقاب السهرة'), titles] : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => act('host:restart') }, 'لعبة جديدة ', icon('repeat'))),
  );
}

const SCREENS = { question: renderQuestion, reveal: renderReveal, final: renderFinal };

function render() {
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  const key = JSON.stringify([state.phase, state.step, state.round, state.standings, state.titles]);
  if ($('#who-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'who-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

function sounds(prev, next) {
  if (prev.step === next.step && prev.phase === next.phase) {
    if (next.phase === 'question' && next.round.votedCount > prev.round.votedCount) sfx.play('join');
    return;
  }
  if (next.phase === 'question') sfx.play('turn');
  else if (next.phase === 'reveal') sfx.play('reveal');
}

HOST_GAMES.who = { render, updateLobby, sounds };
})();
