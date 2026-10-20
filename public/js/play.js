/* global io, $, h, emit, storage, toast, toLatinDigits, connectionBanner, syncClock, setTheme, sfx, syncCrown, pointsText, useTeamNames,
   showScreen, motionKind, bumpChanges */
'use strict';

// The player page shell: joining, the room session and dispatch to the
// current game's screens, which play-herd.js and play-time.js register in
// PLAY_GAMES.

// Connect once every game's screens have loaded.
const socket = io({ autoConnect: false });
document.addEventListener('DOMContentLoaded', () => socket.connect());
const app = $('#app');
const params = new URLSearchParams(location.search);
const sessionKey = (code) => `herd:player:${code}`;
const PLAY_GAMES = {};

let session = null; // { code, playerId, name }
let state = null;
let screenKey = ''; // the game screens use this to skip redraws that change nothing
let lastScene = null; // "game:phase:round", or 'join': a new one slides in

connectionBanner(socket);
sfx.dock();

socket.on('connect', () => {
  const code = session?.code || toLatinDigits(params.get('room') || '').trim();
  const saved = session || (code && storage(sessionKey(code)));
  if (saved) join(code, saved.name, saved.playerId, { rejoin: true });
  else renderJoin({ code });
});

socket.on('player:state', (next) => {
  const prev = state;
  state = next;
  syncClock(next.serverTime);
  render();
  playSounds(prev, next);
});

socket.on('player:kicked', () => {
  const code = session?.code;
  if (code) storage(sessionKey(code), null);
  session = null;
  state = null;
  renderJoin({ code, error: 'المضيف طلعك من الغرفة' });
});

async function join(code, name, playerId, { rejoin = false } = {}) {
  const res = await emit(socket, 'player:join', { code, name, playerId });
  if (!res.ok) {
    if (rejoin) {
      storage(sessionKey(code), null);
      session = null;
    }
    renderJoin({ code, name, error: res.error });
    return;
  }
  session = { code: res.code, playerId: res.playerId, name: res.name };
  storage(sessionKey(res.code), session);
  if (params.get('room') !== res.code) history.replaceState(null, '', `?room=${res.code}`);
  render();
}

/* ---------- Join ---------- */

function renderJoin({ code = '', name = '', error = '' } = {}) {
  screenKey = 'join';
  lastScene = 'join';
  setTheme(null);
  document.getElementById('crown')?.remove();
  const codeInput = h('input', {
    id: 'code', inputmode: 'numeric', maxlength: 4, placeholder: '1234', autocomplete: 'off', value: code,
  });
  const nameInput = h('input', {
    id: 'name', maxlength: 20, placeholder: 'اسمك', autocomplete: 'nickname', enterkeyhint: 'go', value: name,
  });
  const button = h('button', { class: 'btn primary big', type: 'submit' }, 'ادخل');
  // «👥 الشلة»: the room's group offers its names, so everyone keeps the same name in its ranking.
  const picks = h('div', { class: 'name-picks', hidden: true });
  const offerNames = async (room) => {
    picks.hidden = true;
    if (!/^\d{4}$/.test(room)) return;
    const { names = [] } = await fetch(`/api/rooms/${room}/names`).then((r) => r.json()).catch(() => ({}));
    if (!names.length || toLatinDigits(codeInput.value).trim() !== room) return;
    picks.replaceChildren(h('small', {}, '👥 من الشلة؟ اضغط اسمك:'), ...names.map((n) => h('button', {
      type: 'button',
      class: 'category-chip',
      onclick: () => { nameInput.value = n; },
    }, n)));
    picks.hidden = false;
  };
  codeInput.addEventListener('input', () => offerNames(toLatinDigits(codeInput.value).trim()));
  const form = h('form', {
    class: 'card join-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const c = toLatinDigits(codeInput.value).trim();
      const n = nameInput.value.trim();
      if (!c || !n) {
        toast('اكتب رقم الغرفة واسمك');
        return;
      }
      button.disabled = true;
      await join(c, n, storage(sessionKey(c))?.playerId);
      button.disabled = false;
    },
  },
    h('h1', { class: 'center' }, 'ألعاب الشلة 🎲'),
    error ? h('p', { class: 'banner bad' }, error) : null,
    h('label', { class: 'field' }, h('span', {}, 'رقم الغرفة'), codeInput),
    h('label', { class: 'field' }, h('span', {}, 'اسمك'), nameInput),
    picks,
    button,
  );
  app.replaceChildren(h('main', { class: 'narrow' }, form));
  (code ? nameInput : codeInput).focus();
  offerNames(toLatinDigits(code).trim());
}

function render() {
  if (!state || !session) return;
  // A new phase or round slides in; updates within one just redraw.
  const scene = `${state.gameType}:${state.phase}:${state.roundNumber ?? ''}`;
  const prev = lastScene;
  lastScene = scene;
  showScreen(drawGame, prev && prev !== scene ? motionKind(prev, state.phase) : null);
}

function drawGame() {
  if (!state || !session) return;
  const game = state.games.find((g) => g.id === state.gameType);
  document.title = game.name;
  setTheme(state.gameType);
  useTeamNames(state.settings?.teamNames);
  PLAY_GAMES[state.gameType].render();
  placeNightMe();
  placeGroupLine();
  bumpChanges(app);
  syncCrown(state.night, { meId: session.playerId });
}

/** A few sounds on the phone: your turn, the end of a game, the champion of the night. */
function playSounds(prev, next) {
  if (!prev || prev.code !== next.code) return;
  if (!prev.night.crowned && next.night.crowned) {
    sfx.play('crown');
    return;
  }
  if (prev.gameType !== next.gameType) return;
  if (prev.phase !== 'final' && next.phase === 'final') {
    const team = next.me?.team;
    const winner = next.matchWinner ?? next.winner;
    const won = PLAY_GAMES[next.gameType].won?.(next) ?? next.isWinner ?? (team && winner === team);
    sfx.play(won ? 'win' : 'lose');
    return;
  }
  PLAY_GAMES[next.gameType].sounds?.(prev, next);
}

/** «👥 الشلة» playing tonight, at the top of the lobby. */
function placeGroupLine() {
  const main = app.querySelector('main');
  const old = $('#group-line');
  const me = state.groupMe;
  const el = main && state.phase === 'lobby' && state.groupName
    ? h('div', { class: 'night-me group-line', id: 'group-line' }, h('b', {}, '👥 شلة: '), state.groupName,
      me ? ` · ترتيبك ${me.rank} من ${me.of} (${pointsText(me.points)})` : null)
    : null;
  if (old && el && old.isEqualNode(el)) return;
  old?.remove();
  if (el) main.prepend(el);
}

/** Your place in «بطل السهرة», at the top of the lobby. */
function placeNightMe() {
  const main = app.querySelector('main');
  const old = $('#night-me');
  const rows = state.night.standings;
  const mine = rows.find((row) => row.id === session.playerId);
  const leader = rows[0];
  let text = null;
  if (mine?.rank === 1) text = `أنت في الصدارة بـ${pointsText(mine.points)} 👑`;
  else if (mine) text = `ترتيبك ${mine.rank} بـ${pointsText(mine.points)} · الصدارة لـ${leader.name}`;
  else if (leader) text = `الصدارة لـ${leader.name} بـ${pointsText(leader.points)}`;
  const el = main && state.phase === 'lobby' && text
    ? h('div', { class: 'night-me', id: 'night-me' }, h('b', {}, '🏆 بطل السهرة: '), text)
    : null;
  if (old && el && old.isEqualNode(el)) return;
  old?.remove();
  if (el) main.prepend(el);
}
