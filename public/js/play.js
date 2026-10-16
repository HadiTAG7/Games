/* global io, $, h, emit, storage, toast, toLatinDigits, connectionBanner, syncClock */
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

connectionBanner(socket);

socket.on('connect', () => {
  const code = session?.code || toLatinDigits(params.get('room') || '').trim();
  const saved = session || (code && storage(sessionKey(code)));
  if (saved) join(code, saved.name, saved.playerId, { rejoin: true });
  else renderJoin({ code });
});

socket.on('player:state', (next) => {
  state = next;
  syncClock(next.serverTime);
  render();
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
  const codeInput = h('input', {
    id: 'code', inputmode: 'numeric', maxlength: 4, placeholder: '1234', autocomplete: 'off', value: code,
  });
  const nameInput = h('input', {
    id: 'name', maxlength: 20, placeholder: 'اسمك', autocomplete: 'nickname', enterkeyhint: 'go', value: name,
  });
  const button = h('button', { class: 'btn primary big', type: 'submit' }, 'ادخل');
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
    button,
  );
  app.replaceChildren(h('main', { class: 'narrow' }, form));
  (code ? nameInput : codeInput).focus();
}

function render() {
  if (!state || !session) return;
  const game = state.games.find((g) => g.id === state.gameType);
  document.title = game.name;
  PLAY_GAMES[state.gameType].render();
}
