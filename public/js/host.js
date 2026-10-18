/* global io, $, h, emit, storage, toast, connectionBanner, syncClock, setTheme, sfx, nightList, syncCrown, TEAM_ORDER, TEAM_INFO, otherTeam, teamLabel, useTeamNames,
   showScreen, motionKind, bumpChanges */
'use strict';

// The host page shell: connection, room session, the shared lobby pieces
// (join QR, game picker) and dispatch to the current game's screens, which
// host-herd.js and host-time.js register in HOST_GAMES.

// Connect once every game's screens have loaded.
const socket = io({ autoConnect: false });
document.addEventListener('DOMContentLoaded', () => socket.connect());
const app = $('#app');
const SESSION_KEY = 'herd:host';
const REMOTE_KEY = 'host:remote'; // this device is the host's phone («📱 تحكم من جوالك»)
const HOST_GAMES = {};

let state = null;
let info = null; // { code, hostToken, joinUrl, qrSvg }
let renderedKey = null;
let lastScreenKey = '';
let lastScene = null; // "game:phase:round": a new one slides in
const params = new URLSearchParams(location.search);
let forceNew = params.has('new');
let initialGame = forceNew ? params.get('game') : null;
if (forceNew) history.replaceState(null, '', location.pathname);
// «📱 تحكم من جوالك»: this device joins the host's room as a second host screen, answers showing.
const remoteLink = params.get('code') && params.get('token') ? { code: params.get('code'), hostToken: params.get('token') } : null;
if (remoteLink) {
  storage(SESSION_KEY, remoteLink);
  if (params.has('remote')) storage(REMOTE_KEY, true);
  history.replaceState(null, '', location.pathname); // don't leave the host key in the address bar
}
/** Is this the host's own phone (answers can show), rather than the screen everyone watches? */
const isRemote = () => Boolean(storage(REMOTE_KEY));
if (initialGame) setTheme(initialGame); // the game page's colours carry on while the room opens

connectionBanner(socket);
sfx.dock({ withMusic: true });
sfx.timerTicks = true; // the big screen ticks through the last seconds

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
  const prev = state;
  state = next;
  syncClock(next.serverTime);
  render();
  playSounds(prev, next);
});

async function act(event, payload) {
  const res = await emit(socket, event, payload);
  if (!res.ok) toast(res.error);
  return res;
}

function render() {
  if (!state || !info || state.code !== info.code) return;
  // A new phase or round slides in; updates within one just redraw.
  const scene = `${state.gameType}:${state.phase}:${state.roundNumber ?? ''}`;
  const prev = lastScene;
  lastScene = scene;
  showScreen(drawRoom, prev && prev !== scene ? motionKind(prev, state.phase) : null);
}

function drawRoom() {
  if (!state || !info || state.code !== info.code) return;
  const ui = HOST_GAMES[state.gameType];
  const game = state.games.find((g) => g.id === state.gameType);
  document.title = `${game.name} · المضيف`;
  setTheme(state.gameType);
  useTeamNames(state.settings?.teamNames);
  // Switching a bank on or off redraws the lobby, since it changes the categories.
  const banks = state.myBanks ? `${state.myBanks.loggedIn}:${state.myBanks.list.map((b) => `${b.id}${b.on ? '+' : ''}`).join('.')}` : '';
  // A game can ask for a fresh lobby when a setting changes its layout.
  const key = `${state.gameType}:${state.phase}:${banks}:${ui.lobbyKey?.() ?? ''}`;
  // The lobby holds form fields, so keep it and only refresh what changed.
  if (state.phase === 'lobby' && renderedKey === key) {
    ui.updateLobby();
  } else {
    renderedKey = key;
    // Only animate cards the first time a screen appears, not on every update.
    const screenKey = `${key}:${state.roundNumber}`;
    app.classList.toggle('calm', screenKey === lastScreenKey);
    lastScreenKey = screenKey;
    ui.render();
    if (state.phase === 'lobby') ui.updateLobby();
  }
  placeNightCard();
  bumpChanges(app);
  syncCrown(state.night, { onClose: () => act('host:night-crown', { on: false }) });
  sfx.music(state.phase === 'lobby' && !state.night.crowned);
}

/** Sounds for what just changed; each game adds its own through HOST_GAMES[id].sounds. */
function playSounds(prev, next) {
  if (!prev || prev.code !== next.code) return;
  if (!prev.night.crowned && next.night.crowned) {
    sfx.play('crown');
    return;
  }
  if (prev.gameType !== next.gameType) return;
  if (next.phase === 'lobby' && next.playerCount > prev.playerCount) sfx.play('join');
  if (prev.phase !== 'final' && next.phase === 'final') {
    sfx.play('win');
    return;
  }
  HOST_GAMES[next.gameType].sounds?.(prev, next);
}

/* ---------- «بطل السهرة» ---------- */

function nightCard() {
  const rows = state.night.standings;
  if (!rows.length) return null;
  const final = state.phase === 'final';
  return h('section', { class: `card night-card${final ? ' compact' : ''}`, id: 'night-card' },
    h('div', { class: 'field-head' },
      h('h2', {}, final ? '🏆 بطل السهرة لين الحين' : '🏆 بطل السهرة'),
      final ? null : h('button', {
        type: 'button',
        class: 'link-btn small',
        onclick: () => { if (confirm('تصفّر نقاط بطل السهرة لكل اللاعبين؟')) act('host:night-reset'); },
      }, 'صفّر'),
    ),
    h('p', { class: 'hint' }, 'كل لعبة تخلص تضيف نقاط: الفايز 3، والثاني 2، والثالث 1. وفي ألعاب الفرق، كل الفريق الفايز ياخذ 3.'),
    nightList(rows, { limit: final ? 5 : 10 }),
    h('button', { type: 'button', class: 'btn big night-crown-btn', onclick: () => act('host:night-crown', { on: true }) },
      '👑 أعلن بطل السهرة'),
  );
}

/** Keeps the «بطل السهرة» card at the end of the lobby and final screens. */
function placeNightCard() {
  const main = app.querySelector('main');
  const old = $('#night-card');
  const card = main && ['lobby', 'final'].includes(state.phase) ? nightCard() : null;
  if (old && card && old.isEqualNode(card)) return;
  old?.remove();
  if (card) main.append(card);
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

/** In place of the QR code when nobody plays on a phone («📺 بدون جوالات»): the two teams' names. */
function noPhonesCard(text) {
  const names = state.settings.teamNames;
  return h('section', { class: 'card join-card sj-nophones' },
    h('h2', {}, '📺 بدون جوالات'),
    h('p', { class: 'muted' }, text),
    TEAM_ORDER.map((team, i) => h('label', { class: `field sj-team-name ${team}` },
      h('span', {}, `${TEAM_INFO[team].emoji} اسم الفريق ${i ? 'الثاني' : 'الأول'}`),
      h('input', {
        id: `team-name-${team}`,
        maxlength: 20,
        value: names[team],
        placeholder: TEAM_INFO[team].name,
        onchange: (e) => act('host:settings', { teamNames: { [team]: e.target.value } }),
      }))),
    h('button', { type: 'button', class: 'link-btn', onclick: () => act('host:settings', { phones: true }) }, '📱 نلعب بالجوالات'),
  );
}

/**
 * «📱 تحكم من جوالك»: a QR code that opens this host screen on the host's
 * own phone, where the answers can show while the big screen hides them. It
 * carries the host key, so it hides itself after a minute.
 */
function remoteButton() {
  return h('button', {
    type: 'button',
    class: 'btn small remote-btn',
    onclick: () => {
      document.getElementById('remote-modal')?.remove();
      const close = () => modal.remove();
      const modal = h('div', { id: 'remote-modal', class: 'remote-modal', onclick: (e) => { if (e.target === modal) close(); } },
        h('div', { class: 'card remote-card' },
          h('h2', {}, '📱 تحكم من جوالك'),
          h('p', { class: 'muted' }, 'امسحه بجوالك أنت بس: تشوف الأجوبة وتتحكم باللعبة، والشاشة الكبيرة تبقى مخفية.'),
          h('div', { class: 'qr', html: info.remoteQrSvg }),
          h('p', { class: 'hint' }, '⚠️ اللي يمسحه يصير يتحكم بالغرفة، فخلّه لك. يختفي بعد دقيقة.'),
          h('button', { type: 'button', class: 'btn', onclick: close }, 'تم')));
      document.body.append(modal);
      setTimeout(close, 60 * 1000);
    },
  }, '📱 تحكم من جوالك');
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

/* ---------- «بنوكي» ---------- */

/** The logged-in host's own question banks for this game, to switch on for the room. */
function banksBox() {
  const mine = state.myBanks;
  if (!mine) return null;
  if (!mine.loggedIn) {
    return h('p', { class: 'hint banks-login' }, '📚 عندك بنوك أسئلة في حسابك؟ ',
      h('a', { href: `/account?next=${encodeURIComponent('/host')}` }, 'سجّل دخول'), ' وترجع لنفس الغرفة.');
  }
  const on = mine.list.filter((b) => b.on).map((b) => b.id);
  return h('div', { class: 'banks-box' },
    h('div', { class: 'field-head' },
      h('span', {}, h('b', {}, '📚 بنوكي'), h('small', { class: 'muted' }, ` · ${mine.owner}`)),
      h('button', { type: 'button', class: 'link-btn small', onclick: () => act('host:banks-refresh') }, '🔄 تحديث'),
      h('a', { class: 'link-btn small', href: '/account', target: '_blank' }, 'حسابي')),
    mine.list.length
      ? h('div', { class: 'chips' }, mine.list.map((b) => h('button', {
        type: 'button',
        class: `category-chip bank${b.on ? ' picked' : ''}`,
        disabled: !b.playable,
        'aria-pressed': String(b.on),
        title: b.playable ? '' : 'البنك يحتاج عناصر أكثر عشان ينلعب',
        onclick: () => act('host:banks', { ids: b.on ? on.filter((id) => id !== b.id) : [...on, b.id] }),
      }, h('span', {}, b.emoji), h('span', {}, b.name), h('small', { class: 'category-count' }, b.count))))
      : h('p', { class: 'hint' }, 'ما عندك بنوك لهاللعبة. سوّ واحد من ', h('a', { href: '/account', target: '_blank' }, 'حسابك'), '، أو اطلب من الذكاء الاصطناعي.'),
    on.length ? h('p', { class: 'hint' }, '✅ البنوك المختارة انضافت للفئات.') : null,
  );
}

/* ---------- «أسئلتكم الخاصة» ---------- */

/** Sends questions to the site, where they wait for the owner's approval. */
async function sendToSite(game, items) {
  if (!items.length) {
    toast('ما فيه أسئلة صالحة ترسلها');
    return;
  }
  try {
    const res = await fetch('/api/contrib', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game, items: items.slice(0, 50) }),
    });
    const out = await res.json();
    if (!res.ok) toast(out.error);
    else toast(`وصلت ${out.added} للموقع وتنتظر الموافقة${out.errors.length ? ` (${out.errors.length} موجودة أو ناقصة)` : ''} ✅`, 'ok');
  } catch {
    toast('ما قدرنا نرسل، تأكد من النت');
  }
}

/**
 * The lobby box where the host writes questions just for this room. Saving
 * puts them in the room; ticking 📤 also sends them to the site.
 * items(): the saved questions, as entries for «أضف أسئلة».
 */
function customBox({ game, help, inputs, save, items, open = false }) {
  const share = h('input', { type: 'checkbox', id: `${game}-share` });
  return h('details', { class: 'custom-box', open },
    h('summary', {}, '✍️ أسئلتكم الخاصة'),
    h('p', { class: 'hint' }, help),
    ...inputs,
    h('p', { class: 'hint custom-status', id: 'custom-status' }),
    h('label', { class: 'check' }, share, ' 📤 أرسلها للموقع كمان، عشان تطلع للكل (بعد موافقة صاحب الموقع)'),
    h('button', {
      type: 'button',
      class: 'btn',
      onclick: async () => {
        const res = await save();
        if (!res?.ok) return;
        toast('انحفظت لهالغرفة ✅', 'ok');
        if (share.checked) await sendToSite(game, items());
      },
    }, '💾 احفظ'),
  );
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
