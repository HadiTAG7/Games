/* global $, h, act, state, app, field, joinCard, gamePicker, kickButton, endGame, confetti, timerEl, standingsList,
   HOST_GAMES, sfx, osRulesList, osCategory, osTally, osOutsiderBanner, osGains, osRoundTitle, customBox, banksBox, groupBox, icon */
'use strict';

// Host screens for «برا السالفة». This screen is for everyone in the room,
// so it never shows the word or who is out of the loop until the vote is in.
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

const SPACE_ACTIONS = { roles: 'host:os-begin', asking: 'host:os-next', free: 'host:os-vote', roundOver: 'host:next' };
document.addEventListener('keydown', (e) => {
  if (!state || state.gameType !== 'outsider' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, button')) return;
  const action = e.code === 'Space' && SPACE_ACTIONS[state.phase];
  if (!action) return;
  e.preventDefault();
  send(action);
});

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'برا السالفة ', icon('venetian-mask')),
    inGame ? h('div', { class: 'pill' }, osRoundTitle(state)) : null,
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

function categoryChips() {
  return state.categories.map((c) => h('button', {
    type: 'button',
    class: `category-chip${c.id === 'custom' ? ' custom' : ''}`,
    'data-category': c.id,
    onclick: () => toggleCategory(c.id),
  }, h('span', {}, c.name), h('small', { class: 'category-count' }, c.count)));
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
        field('عدد الجولات', select('os-rounds', 'rounds', state.roundsOptions.map((n) => [n, `${n} جولات`]))),
        field('وقت الأسئلة الحرة', select('os-free', 'freeSeconds',
          state.freeSecondsOptions.map((n) => [n, n ? `${n} ثانية` : 'بدون أسئلة حرة']))),
        field('كم واحد برا السالفة؟', select('os-outsiders', 'outsiders',
          [[1, 'واحد'], [2, `اثنين (لو كنتم ${state.rules.twoOutsidersFrom} أو أكثر)`]])),
        h('div', { class: 'field wide' },
          h('div', { class: 'field-head' },
            h('span', {}, 'الفئات: ', h('b', { id: 'os-category-count' })),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories(state.categories.map((c) => c.id)) }, 'الكل'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories([]) }, 'ولا وحدة'),
          ),
          h('div', { class: 'chips os-categories', role: 'group', 'aria-label': 'الفئات' }, categoryChips()),
        ),
      ),
      customBox({
        game: 'outsider',
        open: Boolean(state.custom.text),
        help: `فئة خاصة فيكم: أماكنكم، أصحابكم، سوالفكم. كل كلمة في سطر (أو بينها فاصلة)، وتحتاج ${state.custom.min} كلمات على الأقل.`,
        inputs: [
          h('div', { class: 'settings' },
            field('اسم الفئة', h('input', { id: 'os-custom-name', maxlength: 30, value: state.custom.name, placeholder: 'كلماتنا' }))),
          h('textarea', { id: 'os-custom-text', rows: 4, value: state.custom.text, placeholder: 'استراحة أبو فهد\nمخيم البر\nديوانية' }),
        ],
        save: () => act('host:settings', { custom: { name: $('#os-custom-name').value, text: $('#os-custom-text').value } }),
        items: () => state.custom.words.map((word) => ({ category: '__new', newName: state.custom.name, newEmoji: state.custom.emoji, word })),
      }),
      banksBox(),
      groupBox(),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: () => send('host:start') }, 'ابدأ اللعبة ', icon('venetian-mask')),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  const list = $('#players');
  list.replaceChildren(...state.players.map((p) => h('li', { class: `chip${p.connected ? '' : ' away'}` }, h('span', {}, p.name), kickButton(p))));
  if (!state.players.length) list.append(h('li', { class: 'empty' }, 'لسا ما أحد دخل… امسحوا الباركود'));
  $('#player-count').textContent = state.players.length;
  // The host's own category comes and goes, so redraw the chips when the list changes.
  const box = $('.os-categories');
  const shown = [...box.children].map((el) => `${el.dataset.category}:${el.textContent}`).join('|');
  const fresh = categoryChips();
  if (fresh.map((el) => `${el.dataset.category}:${el.textContent}`).join('|') !== shown) box.replaceChildren(...fresh);
  const picked = currentCategories();
  document.querySelectorAll('.os-categories .category-chip').forEach((el) => {
    const on = picked.includes(el.dataset.category);
    el.classList.toggle('picked', on);
    el.setAttribute('aria-pressed', String(on));
  });
  $('#os-category-count').textContent = `اخترت ${picked.length} من ${state.categories.length}`;
  $('#rules-body').replaceChildren(osRulesList(state.settings, state.rules));
  const { custom } = state;
  $('#custom-status').textContent = custom.words.length
    ? `${custom.words.length} كلمة · ${custom.ready ? 'الفئة جاهزة وانضافت للفئات' : `تحتاج ${custom.min} كلمات على الأقل`}`
    : '';
  const enough = state.players.length >= state.rules.minPlayers;
  $('#start').disabled = !enough || !picked.length;
  let hint = '';
  if (!enough) hint = `تحتاجون ${state.rules.minPlayers} لاعبين على الأقل (دخل ${state.players.length})`;
  else if (!picked.length) hint = 'اختر فئة وحدة على الأقل';
  $('#start-hint').textContent = hint;
}

/* ---------- A round ---------- */

function roundHead() {
  return h('div', { class: 'os-head' }, osCategory(state.round), h('small', {}, osRoundTitle(state)));
}

function renderRoles() {
  return h('main', { class: 'stage narrow os-stage' },
    roundHead(),
    h('div', { class: 'os-big' }, icon('eye')),
    h('h1', { class: 'center' }, 'كل واحد يشوف بطاقته في جواله'),
    h('p', { class: 'center muted' }, state.round.outsiderCount > 1
      ? 'فيه اثنين برا السالفة هالمرة! الباقين يعرفون السالفة.'
      : ['واحد منكم برا السالفة، والباقين يعرفونها. لا تخلّون أحد يشوف جوالكم ', icon('venetian-mask')]),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => send('host:os-begin') }, 'يلا نبدأ الأسئلة ', icon('play')),
    ),
  );
}

function renderAsking() {
  const { round } = state;
  const pair = round.pairs[round.askIndex];
  return h('main', { class: 'stage narrow os-stage' },
    roundHead(),
    h('p', { class: 'center muted' }, `السؤال ${round.askIndex + 1} من ${round.pairs.length}`),
    h('div', { class: 'os-pair' },
      h('div', { class: 'os-person' }, h('small', {}, 'يسأل'), h('b', {}, pair.asker.name)),
      h('div', { class: 'os-arrow' }, '←'),
      h('div', { class: 'os-person' }, h('small', {}, 'يجاوب'), h('b', {}, pair.target.name)),
    ),
    h('p', { class: 'hint center' }, 'اسأل سؤال عن السالفة يبيّن إنك تعرفها، بس لا تفضحها لللي برا السالفة!'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => send('host:os-next') },
        round.askIndex < round.pairs.length - 1 ? ['اللي بعده ', icon('play')] : ['خلصنا الأسئلة ', icon('play')]),
      h('button', { class: 'btn ghost', onclick: () => send('host:os-vote') }, 'خلّونا نصوّت الحين ', icon('vote')),
    ),
  );
}

function renderFree() {
  return h('main', { class: 'stage narrow os-stage' },
    roundHead(),
    h('h1', { class: 'center' }, 'أسئلة حرة! ', icon('megaphone')),
    h('p', { class: 'center muted' }, 'اسألوا أي أحد أي سؤال، وبعدها نصوّت.'),
    timerEl(state.round.endsAt),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => send('host:os-vote') }, 'يلا نصوّت ', icon('vote'))),
  );
}

function renderVote() {
  const { round } = state;
  const voted = new Set(round.voted);
  return h('main', { class: 'stage narrow os-stage' },
    roundHead(),
    h('h1', { class: 'center' }, icon('vote'), ' صوّتوا من جوالاتكم'),
    h('p', { class: 'center muted' }, round.outsiderCount > 1 ? 'مين برا السالفة؟ (فيه اثنين)' : 'مين برا السالفة؟'),
    h('ul', { class: 'chips os-voters' }, round.players.map((p) => h('li', { class: `chip${voted.has(p.id) ? ' done' : ''}` },
      voted.has(p.id) ? [icon('circle-check'), ' '] : [icon('hourglass'), ' '], p.name))),
    h('p', { class: 'center' }, h('b', {}, `${voted.size} من ${round.players.length}`), ' صوّتوا'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => send('host:os-close') }, 'اقفل التصويت')),
  );
}

function renderGuess() {
  const { round } = state;
  const waiting = round.outsiders.filter((o) => !o.guessed).map((o) => o.name);
  return h('main', { class: 'stage narrow os-stage' },
    roundHead(),
    osOutsiderBanner(round),
    osTally(round),
    h('div', { class: 'os-waiting' }, `${waiting.join(' و')} ${waiting.length > 1 ? 'يخمّنون' : 'يخمّن'} السالفة من جواله…`),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => send('host:os-skip-guess') }, 'تخطّى التخمين')),
  );
}

function renderRoundOver() {
  const { round } = state;
  const last = state.roundNumber >= state.totalRounds;
  const parts = [roundHead()];
  if (round.aborted) {
    parts.push(h('div', { class: 'verdict bad' }, 'اللي برا السالفة طلع من الغرفة، نعيد الجولة'));
  } else {
    parts.push(
      h('div', { class: 'os-word' }, h('small', {}, 'السالفة كانت'), h('b', {}, round.word)),
      osOutsiderBanner(round),
      h('div', { class: 'os-guesses' }, round.outsiders.map((o) => h('p', { class: `center os-guess ${o.right ? 'good' : 'bad'}` },
        o.guess
          ? `${o.name} خمّن «${o.guess}» ${o.right ? 'صح!' : 'غلط'}`
          : `${o.name} ما خمّن`))),
      osTally(round),
      h('h2', { class: 'center' }, 'نقاط هالجولة'),
      osGains(round),
    );
  }
  parts.push(
    h('h2', { class: 'center' }, 'الترتيب'),
    standingsList(state.standings, { showGain: false }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => send('host:next') }, last ? ['النتيجة النهائية ', icon('trophy')] : ['الجولة الجاية ', icon('play')]),
      h('button', { class: 'btn ghost', onclick: endGame }, 'إنهاء اللعبة'),
    ),
  );
  return h('main', { class: 'stage narrow os-stage' }, parts);
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

const SCREENS = {
  roles: renderRoles,
  asking: renderAsking,
  free: renderFree,
  vote: renderVote,
  guess: renderGuess,
  roundOver: renderRoundOver,
  final: renderFinal,
};

function render() {
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  const key = JSON.stringify([state.phase, state.step, state.round, state.standings,
    state.phase === 'vote' && state.players.map((p) => p.connected)]);
  if ($('#os-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'os-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

function sounds(prev, next) {
  if (prev.step === next.step && prev.phase === next.phase) {
    if (next.phase === 'vote' && next.round.voted.length > prev.round.voted.length) sfx.play('join');
    return;
  }
  const to = next.phase;
  if (to === 'roles') sfx.play('reveal');
  else if (to === 'asking') sfx.play('turn');
  else if (to === 'free') sfx.play('buzz');
  else if (to === 'vote' && prev.phase !== 'vote') sfx.play('drumroll');
  else if (to === 'guess' && prev.phase === 'vote') sfx.play(next.round.outsiders.some((o) => o.caught) ? 'correct' : 'lose');
  else if (to === 'roundOver' && prev.phase === 'guess') sfx.play(next.round.outsiders.some((o) => o.right) ? 'correct' : 'wrong');
}

HOST_GAMES.outsider = { render, updateLobby, sounds };
})();
