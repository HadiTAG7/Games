/* global io, $, h, emit, storage, toast, connectionBanner, syncClock, TEAM_ORDER, TEAM_INFO, otherTeam, teamLabel */
'use strict';

// The host page shell: connection, room session, the shared lobby pieces
// (join QR, game picker) and dispatch to the current game's screens, which
// host-herd.js and host-time.js register in HOST_GAMES.

// Connect once every game's screens have loaded.
const socket = io({ autoConnect: false });
document.addEventListener('DOMContentLoaded', () => socket.connect());
const app = $('#app');
const SESSION_KEY = 'herd:host';
const HOST_GAMES = {};

let state = null;
let info = null; // { code, hostToken, joinUrl, qrSvg }
let renderedKey = null;
let lastScreenKey = '';
const params = new URLSearchParams(location.search);
let forceNew = params.has('new');
let initialGame = forceNew ? params.get('game') : null;
if (forceNew) history.replaceState(null, '', location.pathname);

connectionBanner(socket);

socket.on('connect', async () => {
  const saved = forceNew ? null : storage(SESSION_KEY);
  let res = saved ? await emit(socket, 'host:resume', saved) : null;
  if (!res || !res.ok) res = await emit(socket, 'host:create', { gameType: initialGame });
  forceNew = false;
  initialGame = null;
  if (!res.ok) {
    toast(res.error);
    return;
  }
  if (!info || info.code !== res.code) renderedKey = null;
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
  const ui = HOST_GAMES[state.gameType];
  const game = state.games.find((g) => g.id === state.gameType);
  document.title = `${game.name} · المضيف`;
  const key = `${state.gameType}:${state.phase}`;
  // The lobby holds form fields, so keep it and only refresh what changed.
  if (state.phase === 'lobby' && renderedKey === key) {
    ui.updateLobby();
    return;
  }
  renderedKey = key;
  // Only animate cards the first time a screen appears, not on every update.
  const screenKey = `${key}:${state.roundNumber}`;
  app.classList.toggle('calm', screenKey === lastScreenKey);
  lastScreenKey = screenKey;
  ui.render();
  if (state.phase === 'lobby') ui.updateLobby();
}

/* ---------- Shared pieces ---------- */

function field(label, control) {
  return h('label', { class: 'field' }, h('span', {}, label), control);
}

function joinCard() {
  return h('section', { class: 'card join-card' },
    h('h2', {}, 'امسحوا الباركود وادخلوا 📱'),
    h('div', { class: 'qr', html: info.qrSvg }),
    h('div', { class: 'big-code' }, h('small', {}, 'أو ادخلوا برقم الغرفة'), h('b', {}, state.code)),
    h('button', { class: 'link-btn', title: 'نسخ الرابط', onclick: copyLink }, info.joinUrl),
  );
}

/** The two games as cards; picking one switches the whole room. */
function gamePicker() {
  return h('div', { class: 'game-picker', role: 'radiogroup', 'aria-label': 'اللعبة' },
    state.games.map((game) => h('button', {
      type: 'button',
      class: `game-option${game.id === state.gameType ? ' picked' : ''}`,
      role: 'radio',
      'aria-checked': String(game.id === state.gameType),
      onclick: () => { if (game.id !== state.gameType) act('host:game-type', { gameType: game.id }); },
    }, h('span', { class: 'game-emoji' }, game.emoji), h('b', {}, game.name))));
}

function kick(player) {
  if (confirm(`تطرد ${player.name} من الغرفة؟`)) act('host:kick', { playerId: player.id });
}

function kickButton(player) {
  return h('button', {
    class: 'x',
    title: `طرد ${player.name}`,
    'aria-label': `طرد ${player.name}`,
    onclick: (e) => { e.stopPropagation(); kick(player); },
  }, '×');
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

/* ---------- Teams (the team games' lobbies) ---------- */

function teamsSection() {
  return [
    h('div', { class: 'field-head tc-teams-head' },
      h('h2', {}, 'الفرق ', h('span', { id: 'player-count', class: 'count' })),
      h('button', { type: 'button', class: 'btn small', onclick: () => act('host:shuffle') }, '🔀 وزّعهم عشوائي'),
    ),
    h('div', { class: 'tc-teams' }, TEAM_ORDER.map((team) => h('div', { class: `tc-team ${team}` },
      h('h3', {}, teamLabel(team), h('span', { class: 'count', 'data-team-count': team })),
      h('ul', { class: 'chips', 'data-team': team }),
    ))),
    h('p', { class: 'hint' }, 'اضغط على اسم أي لاعب عشان تنقله للفريق الثاني'),
  ];
}

function updateTeamsSection() {
  for (const team of TEAM_ORDER) {
    const players = state.teams[team];
    const list = $(`[data-team="${team}"]`);
    list.replaceChildren(...players.map((p) => h('li', { class: `chip${p.connected ? '' : ' away'}` },
      h('button', {
        type: 'button',
        class: 'chip-btn',
        title: `انقل ${p.name} للفريق ${TEAM_INFO[otherTeam(team)].name}`,
        onclick: () => act('host:team', { playerId: p.id, team: otherTeam(team) }),
      }, p.name),
      kickButton(p),
    )));
    if (!players.length) list.append(h('li', { class: 'empty' }, 'ما فيه أحد'));
    $(`[data-team-count="${team}"]`).textContent = players.length;
  }
  $('#player-count').textContent = state.players.length;
}
