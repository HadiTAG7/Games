/* global $, h, act, state, app, field, joinCard, gamePicker, kickButton, endGame, confetti, timerEl, HOST_GAMES, sfx,
   MF_ROLES, mfRole, mfLineup, mfRulesList, mfPlayers, mfAnnouncement, mfWinnerText */
'use strict';

// Host screens for «مافيا». This screen is the narrator, in front of
// everyone, so it never shows a secret role until the game is over.
(() => {
let busy = false;

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

function topbar() {
  const inGame = !['lobby', 'final'].includes(state.phase);
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'مافيا 🎭'),
    inGame && state.dayNumber ? h('div', { class: 'pill' }, `الليلة ${state.dayNumber}`) : null,
    h('div', { class: 'pill' }, 'الغرفة ', h('b', {}, state.code)),
  );
}

/* ---------- Lobby ---------- */

function renderLobby() {
  const s = state.settings;
  return h('main', { class: 'lobby' },
    joinCard(),
    h('section', { class: 'card' },
      gamePicker(),
      h('h2', {}, 'اللاعبين ', h('span', { id: 'player-count', class: 'count' })),
      h('ul', { id: 'players', class: 'chips' }),
      h('h2', {}, 'الإعدادات'),
      h('div', { class: 'settings' },
        field('عدد المافيا', h('select', { id: 'mf-mafia', onchange: (e) => act('host:settings', { mafia: Number(e.target.value) }) },
          [[0, 'تلقائي حسب العدد'], [1, 'واحد'], [2, 'اثنين'], [3, 'ثلاثة']]
            .map(([v, label]) => h('option', { value: v, selected: v === s.mafia }, label)))),
        field('وقت النقاش', h('select', { id: 'mf-discuss', onchange: (e) => act('host:settings', { discussSeconds: Number(e.target.value) }) },
          state.rules.discussOptions.map((v) => h('option', { value: v, selected: v === s.discussSeconds },
            v ? `${v / 60} دقايق`.replace('2 دقايق', 'دقيقتين') : 'بدون وقت')))),
        field('لما أحد يطلع', h('select', { id: 'mf-reveal', onchange: (e) => act('host:settings', { revealOnDeath: e.target.value === 'yes' }) },
          [['yes', 'ينكشف دوره'], ['no', 'دوره يبقى سر']].map(([v, label]) => h('option', { value: v, selected: (v === 'yes') === s.revealOnDeath }, label)))),
        h('div', { class: 'field wide' },
          h('span', {}, 'الأدوار'),
          h('div', { class: 'chips mf-role-toggles', role: 'group', 'aria-label': 'الأدوار' },
            ['doctor', 'police', 'sniper', 'mayor'].map((role) => h('button', {
              type: 'button',
              class: 'category-chip',
              'data-role': role,
              onclick: () => act('host:settings', { roles: { [role]: !state.settings.roles[role] } }),
            }, mfRole(role)))),
        ),
      ),
      h('div', { class: 'mf-lineup-box' }, h('b', { id: 'mf-lineup-title' }), h('div', { id: 'mf-lineup' })),
      h('details', { class: 'rules' }, h('summary', {}, 'طريقة اللعب'), h('div', { id: 'rules-body' })),
      h('button', { id: 'start', class: 'btn primary big', onclick: () => send('host:start') }, 'وزّع الأدوار 🎭'),
      h('p', { id: 'start-hint', class: 'hint center' }),
    ),
  );
}

function updateLobby() {
  const list = $('#players');
  list.replaceChildren(...state.players.map((p) => h('li', { class: `chip${p.connected ? '' : ' away'}` }, h('span', {}, p.name), kickButton(p))));
  if (!state.players.length) list.append(h('li', { class: 'empty' }, 'لسا ما أحد دخل… امسحوا الباركود'));
  $('#player-count').textContent = state.players.length;
  document.querySelectorAll('.mf-role-toggles .category-chip').forEach((el) => {
    const on = state.settings.roles[el.dataset.role];
    el.classList.toggle('picked', on);
    el.setAttribute('aria-pressed', String(on));
  });
  $('#mf-lineup-title').textContent = `التوزيع لـ${state.players.length} لاعبين:`;
  $('#mf-lineup').replaceChildren(mfLineup(state.lineup));
  $('#rules-body').replaceChildren(mfRulesList(state.lineup));
  const enough = state.players.length >= state.rules.minPlayers;
  $('#start').disabled = !enough;
  $('#start-hint').textContent = enough ? '' : `تحتاجون ${state.rules.minPlayers} لاعبين على الأقل (دخل ${state.players.length})`;
}

/* ---------- The game ---------- */

const mayorName = () => state.players.find((p) => p.id === state.mayor)?.name;

function renderRoles() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('div', { class: 'mf-big' }, '🎭'),
    h('h1', { class: 'center' }, 'كل واحد يشوف دوره في جواله'),
    h('p', { class: 'center muted' }, 'خلّ جوالك لنفسك، ولا تفضح دورك 🤫'),
    mfLineup(state.lineup),
    state.mayor ? h('p', { class: 'center mf-mayor' }, `🎩 العمدة: ${mayorName()}، صوته بصوتين`) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => send('host:mf-night') }, 'ابدأ الليل الأول 🌙')),
  );
}

function renderNight() {
  const night = state.nightProgress;
  return h('main', { class: 'stage narrow mf-stage mf-night' },
    h('div', { class: 'mf-big' }, '🌙'),
    h('h1', { class: 'center' }, `الليلة ${state.dayNumber}… الكل يختار من جواله`),
    h('p', { class: 'center muted' }, 'المافيا يتفقون على ضحية، والدكتور ينقذ، والشرطي يسأل… والباقين يختارون مين يشكّون فيه.'),
    timerEl(state.endsAt),
    h('p', { class: 'center' }, h('b', {}, `${night.acted} من ${night.total}`), ' اختاروا'),
    mfPlayers(state.players),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => send('host:mf-end-night') }, 'خلّص الليل ☀️')),
  );
}

function nextButtons() {
  if (state.winner) {
    return h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => send('host:next') }, 'النتيجة النهائية 🏆'));
  }
  if (state.phase === 'morning') {
    return h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => send('host:mf-discuss') }, 'ابدأ النقاش 🗣️'),
      h('button', { class: 'btn ghost', onclick: () => send('host:mf-vote') }, 'صوّتوا على طول 🗳️'),
    );
  }
  return h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => send('host:mf-night') }, 'الليل 🌙'));
}

function renderMorning() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('div', { class: 'mf-big' }, '☀️'),
    h('h1', { class: 'center' }, 'صباح الخير!'),
    mfAnnouncement(state.announcement),
    state.winner ? h('div', { class: `verdict ${state.winner === 'mafia' ? 'bad' : 'good'}` }, mfWinnerText(state.winner)) : null,
    mfPlayers(state.players),
    nextButtons(),
  );
}

function renderDiscuss() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center' }, '🗣️ تناقشوا: مين المافيا؟'),
    timerEl(state.endsAt),
    state.mayor ? h('p', { class: 'center mf-mayor' }, `🎩 العمدة: ${mayorName()}`) : null,
    mfPlayers(state.players),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => send('host:mf-vote') }, 'يلا نصوّت 🗳️')),
  );
}

function renderVote() {
  const voted = new Set(state.voted);
  const alive = state.players.filter((p) => p.alive);
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center' }, '🗳️ صوّتوا من جوالاتكم: مين يطلع؟'),
    h('ul', { class: 'chips os-voters' }, alive.map((p) => h('li', { class: `chip${voted.has(p.id) ? ' done' : ''}` },
      voted.has(p.id) ? '✅ ' : '⏳ ', p.name))),
    h('p', { class: 'center' }, h('b', {}, `${voted.size} من ${alive.length}`), ' صوّتوا'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => send('host:mf-end-vote') }, 'اقفل التصويت')),
  );
}

function renderVerdict() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center' }, 'نتيجة التصويت'),
    mfAnnouncement(state.announcement),
    state.winner ? h('div', { class: `verdict ${state.winner === 'mafia' ? 'bad' : 'good'}` }, mfWinnerText(state.winner)) : null,
    mfPlayers(state.players),
    nextButtons(),
  );
}

function renderFinal() {
  const { winner } = state;
  return h('main', { class: 'stage narrow final mf-stage' },
    winner ? confetti() : null,
    h('div', { class: 'trophy' }, winner === 'mafia' ? '🔪' : winner ? '🏆' : '🎭'),
    h('h1', { class: 'winner-name' }, winner ? mfWinnerText(winner) : 'انتهت اللعبة'),
    h('h2', { class: 'center' }, 'الأدوار كانت'),
    mfPlayers(state.players),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => act('host:restart') }, 'لعبة جديدة 🔁')),
  );
}

const SCREENS = {
  roles: renderRoles,
  night: renderNight,
  morning: renderMorning,
  discuss: renderDiscuss,
  vote: renderVote,
  verdict: renderVerdict,
  final: renderFinal,
};

function render() {
  if (state.phase === 'lobby') {
    app.replaceChildren(topbar(), renderLobby());
    return;
  }
  const key = JSON.stringify([state.phase, state.step, state.players, state.nightProgress, state.voted, state.announcement, state.winner]);
  if ($('#mf-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'mf-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

function sounds(prev, next) {
  if (prev.phase === next.phase) {
    if (next.phase === 'vote' && next.voted.length > prev.voted.length) sfx.play('join');
    return;
  }
  const to = next.phase;
  if (to === 'roles') sfx.play('reveal');
  else if (to === 'night') sfx.play('night');
  else if (to === 'morning') sfx.play(next.announcement?.deaths.length ? 'lose' : 'morning');
  else if (to === 'discuss') sfx.play('turn');
  else if (to === 'vote') sfx.play('drumroll');
  else if (to === 'verdict') sfx.play(next.announcement?.out ? 'wrong' : 'skip');
}

HOST_GAMES.mafia = { render, updateLobby, sounds };
})();
