/* global $, h, act, state, app, field, joinCard, gamePicker, kickButton, endGame, confetti, timerEl, standingsList,
   HOST_GAMES, sfx, tfRulesList, tfRoundTitle, tfAnswer, tfSplit, tfBest, banksBox, groupBox, icon */
'use strict';

// Host screens for «صح ولا خطأ». The screen shows the statement and the clock;
// the answer only once the time is up or everyone has answered.
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
  if (!state || state.gameType !== 'truth' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, button')) return;
  if (e.code !== 'Space') return;
  if (state.phase === 'statement') send('host:tf-reveal');
  else if (state.phase === 'reveal') send('host:next');
  else return;
  e.preventDefault();
});

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'صح ولا خطأ ', icon('circle-check-big')),
    inGame ? h('div', { class: 'pill' }, tfRoundTitle(state.round)) : null,
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
  $('#tf-categories-wrap').hidden = source === 'custom';
  $('#tf-custom-wrap').hidden = source === 'bank';
}

function renderLobby() {
  const s = state.settings;
  const select = (id, key, options) => h('select', { id, onchange: (e) => act('host:settings', { [key]: Number(e.target.value) }) },
    options.map(([value, label]) => h('option', { value, selected: value === s[key] }, label)));
  return h('main', { class: 'lobby' },
    joinCard(),
    h('section', { class: 'card' },
      gamePicker(),
      h('h2', {}, 'اللاعبين ', h('span', { id: 'player-count', class: 'count' })),
      h('ul', { id: 'players', class: 'chips' }),
      h('h2', {}, 'الإعدادات'),
      h('div', { class: 'settings' },
        field('عدد العبارات', select('tf-rounds', 'rounds', state.roundsOptions.map((n) => [n, `${n} عبارة`]))),
        field('وقت كل عبارة', select('tf-seconds', 'seconds', state.secondsOptions.map((n) => [n, `${n} ثواني`]))),
        h('label', { class: 'field wide' }, h('span', {}, 'العبارات'), h('select', {
          id: 'tf-source',
          onchange: (e) => {
            showSource(e.target.value);
            act('host:settings', { source: e.target.value });
          },
        }, [['bank', 'بنك العبارات'], ['custom', 'عباراتي أنا'], ['mix', 'عباراتي + بنك العبارات']]
          .map(([value, label]) => h('option', { value, selected: value === s.source }, label)))),
        h('div', { class: 'field wide', id: 'tf-categories-wrap', hidden: s.source === 'custom' },
          h('div', { class: 'field-head' },
            h('span', {}, 'الفئات: ', h('b', { id: 'tf-category-count' })),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories(state.categories.map((c) => c.id)) }, 'الكل'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories([]) }, 'ولا وحدة'),
          ),
          h('div', { class: 'chips tf-categories', role: 'group', 'aria-label': 'الفئات' }, state.categories.map((c) => h('button', {
            type: 'button',
            class: 'category-chip',
            'data-category': c.id,
            onclick: () => toggleCategory(c.id),
          }, h('span', {}, c.name), h('small', { class: 'category-count' }, c.count)))),
        ),
        h('div', { class: 'field wide', id: 'tf-custom-wrap', hidden: s.source === 'bank' },
          h('label', { class: 'field' }, h('span', {}, 'عباراتكم'), h('textarea', {
            id: 'tf-custom',
            rows: 5,
            value: state.custom.text,
            placeholder: 'كل عبارة في سطر، وبعدها | صح أو | خطأ\nأبو فهد أكبر واحد في الشلة | صح\nاستراحتنا في الدمام | خطأ',
            onchange: (e) => act('host:settings', { custom: e.target.value }),
          })),
          h('p', { class: 'hint', id: 'tf-custom-status' }),
        ),
      ),
      banksBox(),
      groupBox(),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: startGame }, 'ابدأ اللعبة ', icon('circle-check-big')),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

async function startGame() {
  // The textarea only reports on blur: send what's typed first.
  const res = await act('host:settings', { custom: $('#tf-custom').value });
  if (res.ok) send('host:start');
}

function updateLobby() {
  const s = state.settings;
  const list = $('#players');
  list.replaceChildren(...state.players.map((p) => h('li', { class: `chip${p.connected ? '' : ' away'}` }, h('span', {}, p.name), kickButton(p))));
  if (!state.players.length) list.append(h('li', { class: 'empty' }, 'لسا ما أحد دخل… امسحوا الباركود'));
  $('#player-count').textContent = state.players.length;
  const picked = currentCategories();
  document.querySelectorAll('.tf-categories .category-chip').forEach((el) => {
    const on = picked.includes(el.dataset.category);
    el.classList.toggle('picked', on);
    el.setAttribute('aria-pressed', String(on));
  });
  $('#tf-category-count').textContent = `اخترت ${picked.length} من ${state.categories.length}`;
  if (document.activeElement?.id !== 'tf-source') $('#tf-source').value = s.source;
  showSource($('#tf-source').value);
  const { custom } = state;
  $('#tf-custom-status').textContent = [
    custom.count ? `${custom.count} عبارة (أكثر شي ${custom.max})` : '',
    custom.bad ? `${custom.bad} سطر ما فهمته: اكتب بعد العبارة | صح أو | خطأ` : '',
  ].filter(Boolean).join(' · ');
  $('#rules-body').replaceChildren(tfRulesList(s, state.rules));
  const enough = state.players.length >= state.rules.minPlayers;
  const noStatements = s.source === 'custom' ? !custom.count : s.source === 'bank' && !picked.length;
  $('#start').disabled = !enough || noStatements;
  let hint = '';
  if (!enough) hint = `تحتاجون ${state.rules.minPlayers} لاعبين على الأقل (دخل ${state.players.length})`;
  else if (noStatements) hint = s.source === 'custom' ? 'اكتب عبارة وحدة على الأقل واضغط برا المربع' : 'اختر فئة وحدة على الأقل';
  $('#start-hint').textContent = hint;
}

/* ---------- A statement ---------- */

function renderStatement() {
  const { round } = state;
  return h('main', { class: 'stage narrow tf-stage' },
    round.category ? h('div', { class: 'category-tag' }, round.category) : null,
    timerEl(round.endsAt),
    h('h1', { class: 'question tf-statement' }, round.statement),
    h('div', { class: 'tf-choices-hint', 'aria-hidden': 'true' },
      h('span', { class: 'yes' }, icon('circle-check-big'), ' صح'), h('span', { class: 'no' }, icon('circle-x'), ' خطأ')),
    h('p', { class: 'center tf-answered' }, h('b', { 'data-bump': 'tf-answered' }, `${round.answeredCount} من ${round.playerCount}`), ' جاوبوا'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => send('host:tf-reveal') }, 'اكشف الجواب ', icon('eye')),
      h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
  );
}

function renderReveal() {
  const { round } = state;
  const { result } = round;
  const last = round.number >= round.total;
  return h('main', { class: 'stage narrow tf-stage' },
    h('p', { class: 'tf-asked' }, round.statement),
    tfAnswer(result),
    tfSplit(result),
    h('h2', { class: 'center' }, 'أسرع اللي جابوها'),
    tfBest(result),
    h('h2', { class: 'center' }, 'الترتيب'),
    standingsList(state.standings),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => send('host:next') }, last ? ['النتيجة النهائية ', icon('trophy')] : ['العبارة الجاية ', icon('play')]),
      last ? null : h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
  );
}

function renderFinal() {
  const top = state.standings.filter((r) => r.rank === 1 && r.score > 0);
  return h('main', { class: 'stage narrow final' },
    top.length ? confetti() : null,
    h('div', { class: 'trophy' }, top.length ? icon('trophy') : icon('handshake')),
    h('h1', { class: 'winner-name' }, top.length ? top.map((r) => r.name).join(' و') : 'محد كسب نقاط'),
    top.length ? h('p', { class: 'muted center' }, `بـ ${top[0].score} نقطة`) : null,
    standingsList(state.standings, { showGain: false }),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => act('host:restart') }, 'لعبة جديدة ', icon('repeat'))),
  );
}

const SCREENS = { statement: renderStatement, reveal: renderReveal, final: renderFinal };

function render() {
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  const key = JSON.stringify([state.phase, state.step, state.round, state.standings]);
  if ($('#tf-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'tf-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

function sounds(prev, next) {
  if (prev.step === next.step && prev.phase === next.phase) {
    if (next.phase === 'statement' && next.round.answeredCount > prev.round.answeredCount) sfx.play('join');
    return;
  }
  if (next.phase === 'statement') sfx.play('turn');
  else if (next.phase === 'reveal') sfx.play('reveal');
}

HOST_GAMES.truth = { render, updateLobby, sounds };
})();
