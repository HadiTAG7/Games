/* global $, h, act, state, app, field, joinCard, gamePicker, kickButton, endGame, confetti, timerEl, standingsList,
   HOST_GAMES, sfx, scRulesList, scRoundTitle, scCategory, scTally, scImpostorBanner, scMission, scLines, scVoters, scWheel,
   banksBox, groupBox, icon */
'use strict';

// Host screens for «مين النصاب؟». This screen is for everyone in the room, so
// it never shows the word, the impostor or the mission until the vote is in.
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

const SPACE_ACTIONS = { roles: 'host:sc-begin', hints: 'host:sc-next', discuss: 'host:sc-vote', guess: null, roundOver: 'host:next' };
document.addEventListener('keydown', (e) => {
  if (!state || state.gameType !== 'scam' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, button')) return;
  const action = e.code === 'Space' && SPACE_ACTIONS[state.phase];
  if (!action) return;
  e.preventDefault();
  send(action);
});

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'مين النصاب؟ ', icon('fingerprint')),
    inGame ? h('div', { class: 'pill' }, scRoundTitle(state)) : null,
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
        field('عدد الجولات', select('sc-rounds', 'rounds', state.roundsOptions.map((n) => [n, `${n} جولات`]))),
        field('وقت النقاش', select('sc-discuss', 'discussSeconds', state.discussOptions.map((n) => [n, n ? `${n / 60} دقايق` : 'بدون مؤقت']))),
        h('div', { class: 'field wide' },
          h('div', { class: 'field-head' },
            h('span', {}, 'الفئات: ', h('b', { id: 'sc-category-count' })),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories(state.categories.map((c) => c.id)) }, 'الكل'),
            h('button', { type: 'button', class: 'link-btn small', onclick: () => setCategories([]) }, 'ولا وحدة'),
          ),
          h('div', { class: 'chips sc-categories', role: 'group', 'aria-label': 'الفئات' }, state.categories.map((c) => h('button', {
            type: 'button',
            class: 'category-chip',
            'data-category': c.id,
            onclick: () => toggleCategory(c.id),
          }, h('span', {}, c.name), h('small', { class: 'category-count' }, c.count)))),
        ),
      ),
      banksBox(),
      groupBox(),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: () => send('host:start') }, 'ابدأ اللعبة ', icon('fingerprint')),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  const list = $('#players');
  list.replaceChildren(...state.players.map((p) => h('li', { class: `chip${p.connected ? '' : ' away'}` }, h('span', {}, p.name), kickButton(p))));
  if (!state.players.length) list.append(h('li', { class: 'empty' }, 'لسا ما أحد دخل… امسحوا الباركود'));
  $('#player-count').textContent = state.players.length;
  const picked = currentCategories();
  document.querySelectorAll('.sc-categories .category-chip').forEach((el) => {
    const on = picked.includes(el.dataset.category);
    el.classList.toggle('picked', on);
    el.setAttribute('aria-pressed', String(on));
  });
  $('#sc-category-count').textContent = `اخترت ${picked.length} من ${state.categories.length}`;
  $('#rules-body').replaceChildren(scRulesList(state.settings, state.rules));
  const enough = state.players.length >= state.rules.minPlayers;
  $('#start').disabled = !enough || !picked.length;
  let hint = '';
  if (!enough) hint = `تحتاجون ${state.rules.minPlayers} لاعبين على الأقل (دخل ${state.players.length})`;
  else if (!picked.length) hint = 'اختر فئة وحدة على الأقل';
  $('#start-hint').textContent = hint;
}

/* ---------- A round ---------- */

function roundHead() {
  return h('div', { class: 'os-head' }, scCategory(state.round), h('small', {}, scRoundTitle(state)));
}

/** The hint circle: who's spoken, who's on, who's next. */
function circle(round, { current = null } = {}) {
  return h('ol', { class: 'sc-circle' }, round.order.map((p, i) => h('li', {
    class: i === current ? 'now' : current !== null && i < current ? 'done' : null,
  }, h('b', {}, i + 1), p.name)));
}

function renderRoles() {
  return h('main', { class: 'stage narrow sc-stage' },
    roundHead(),
    h('div', { class: 'os-big' }, icon('eye')),
    h('h1', { class: 'center' }, 'كل واحد يشوف بطاقته في جواله'),
    h('p', { class: 'center muted' }, 'واحد منكم النصاب: ما يعرف الكلمة، وعنده مهمة سرية ينفّذها وسط الكلام. انتبهوا له!'),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => send('host:sc-begin') }, 'يلا نبدأ التلميح ', icon('play'))),
  );
}

function renderHints() {
  const { round } = state;
  const now = round.order[round.hintIndex];
  const last = round.hintIndex >= round.order.length - 1;
  return h('main', { class: 'stage narrow sc-stage' },
    roundHead(),
    h('div', { class: 'sc-turn' }, h('small', {}, `التلميح ${round.hintIndex + 1} من ${round.order.length}`), h('b', {}, `دور ${now.name}`),
      h('span', {}, 'قل كلمة وحدة تلمّح للكلمة السرية')),
    circle(round, { current: round.hintIndex }),
    h('ul', { class: 'sc-rules-mini' },
      h('li', {}, icon('ban'), ' لا تقول الكلمة نفسها'),
      h('li', {}, icon('repeat'), ' لا تكرر تلميح أحد'),
      h('li', {}, icon('eye-off'), ' لا تشرح على المكشوف')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => send('host:sc-next') }, last ? ['خلصنا، نتناقش ', icon('megaphone')] : ['اللي بعده ', icon('play')]),
      h('button', { class: 'btn ghost', onclick: () => send('host:sc-vote') }, 'صوّتوا على طول ', icon('vote')),
    ),
  );
}

function renderDiscuss() {
  return h('main', { class: 'stage narrow sc-stage' },
    roundHead(),
    h('h1', { class: 'center' }, icon('megaphone'), ' تناقشوا!'),
    timerEl(state.round.endsAt),
    h('p', { class: 'center muted' }, 'كل واحد بدوره: يسأل اللي يشك فيه، أو يعطي تلميح زيادة. وانتبهوا لأي كلام غريب… يمكن هي المهمة!'),
    circle(state.round),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => send('host:sc-vote') }, 'يلا نصوّت ', icon('vote'))),
  );
}

function renderVote() {
  const { round } = state;
  const voted = new Set(round.voted);
  return h('main', { class: 'stage narrow sc-stage' },
    roundHead(),
    h('h1', { class: 'center' }, icon('vote'), ' صوّتوا من جوالاتكم'),
    h('p', { class: 'center muted' }, 'سؤالين: مين النصاب؟ ووش كانت مهمته السرية؟'),
    h('ul', { class: 'chips os-voters' }, round.order.map((p) => h('li', { class: `chip${voted.has(p.id) ? ' done' : ''}` },
      voted.has(p.id) ? [icon('circle-check'), ' '] : [icon('hourglass'), ' '], p.name))),
    h('p', { class: 'center' }, h('b', {}, `${voted.size} من ${round.order.length}`), ' جاوبوا'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => send('host:sc-close') }, 'اقفل التصويت')),
  );
}

function renderReveal() {
  const { round } = state;
  return h('main', { class: 'stage narrow sc-stage' },
    roundHead(),
    scTally(round),
    scImpostorBanner(round),
    scMission(round),
    round.exposed
      ? h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => send('host:sc-judge') }, 'النصاب يخمّن الكلمة ', icon('play')))
      : h('div', { class: 'sc-judge' },
        h('p', { class: 'center' }, h('b', {}, 'نفّذ مهمته؟'), ' قرروا مع بعض'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary big', onclick: () => send('host:sc-judge', { done: true }) }, icon('circle-check'), ' نفّذها'),
          h('button', { class: 'btn big', onclick: () => send('host:sc-judge', { done: false }) }, icon('circle-x'), ' ما نفّذها'))),
  );
}

function renderGuess() {
  const { round } = state;
  return h('main', { class: 'stage narrow sc-stage' },
    roundHead(),
    scImpostorBanner(round),
    h('div', { class: 'os-waiting' }, `${round.impostor.name} يخمّن الكلمة من جواله…`),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => send('host:sc-skip-guess') }, 'تخطّى التخمين')),
  );
}

function renderRoundOver() {
  const { round } = state;
  const last = state.roundNumber >= state.totalRounds;
  const parts = [roundHead()];
  if (round.aborted) {
    parts.push(h('div', { class: 'verdict bad' }, 'النصاب طلع من الغرفة، نعيد الجولة'));
  } else {
    parts.push(
      h('div', { class: 'os-word' }, h('small', {}, 'الكلمة كانت'), h('b', {}, round.word)),
      h('p', { class: `center os-guess ${round.guess.right ? 'good' : 'bad'}` },
        round.guess.word ? `${round.impostor.name} خمّن «${round.guess.word}» ${round.guess.right ? 'صح!' : 'غلط'}` : `${round.impostor.name} ما خمّن`),
      scLines(round),
      h('h2', { class: 'center' }, 'اللي صوّتوا صح'),
      scVoters(round),
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
  return h('main', { class: 'stage narrow sc-stage' }, parts);
}

function renderFinal() {
  const top = state.standings.filter((r) => r.rank === 1 && r.score > 0);
  const p = state.punishment;
  const lowest = state.standings.at(-1);
  const losers = state.standings.filter((r) => r.score === lowest?.score);
  return h('main', { class: 'stage narrow final sc-stage' },
    top.length ? confetti() : null,
    h('div', { class: 'trophy' }, top.length ? icon('trophy') : icon('handshake')),
    h('h1', { class: 'winner-name' }, top.length ? top.map((r) => r.name).join(' و') : 'محد كسب نقاط'),
    top.length ? h('p', { class: 'muted center' }, `بـ ${top[0].score} نقطة`) : null,
    standingsList(state.standings, { showGain: false }),
    state.standings.length > 1 ? h('section', { class: 'card sc-punish-box' },
      h('h2', { class: 'center' }, icon('gavel'), ' دولاب العقاب'),
      p ? scWheel(p) : h('p', { class: 'center muted' }, losers.length > 1
        ? `أقل نقاط: ${losers.map((r) => r.name).join(' و')}، والدولاب يختار واحد منهم بالقرعة`
        : `أقل نقاط: ${lowest.name}… يلا نشوف وش عقابه!`),
      h('div', { class: 'actions' }, h('button', { class: `btn ${p ? 'ghost' : 'primary big'}`, onclick: () => send('host:sc-spin') },
        p ? ['دوّر مرة ثانية ', icon('refresh-cw')] : ['دوّر الدولاب ', icon('gavel')])),
    ) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => act('host:restart') }, 'لعبة جديدة ', icon('repeat'))),
  );
}

const SCREENS = {
  roles: renderRoles,
  hints: renderHints,
  discuss: renderDiscuss,
  vote: renderVote,
  reveal: renderReveal,
  guess: renderGuess,
  roundOver: renderRoundOver,
  final: renderFinal,
};

function render() {
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  const key = JSON.stringify([state.phase, state.step, state.round, state.standings, state.punishment,
    state.phase === 'vote' && state.players.map((p) => p.connected)]);
  if ($('#sc-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'sc-root';
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
  else if (to === 'hints') sfx.play('turn');
  else if (to === 'discuss') sfx.play('buzz');
  else if (to === 'vote' && prev.phase !== 'vote') sfx.play('drumroll');
  else if (to === 'reveal' && prev.phase === 'vote') sfx.play(next.round.caught ? 'correct' : 'lose');
  else if (to === 'roundOver' && prev.phase === 'guess') sfx.play(next.round.guess?.right ? 'wrong' : 'correct');
  else if (to === 'final' && next.punishment && next.punishment.spinId !== prev.punishment?.spinId) sfx.play('drumroll');
}

HOST_GAMES.scam = { render, updateLobby, sounds };
})();
