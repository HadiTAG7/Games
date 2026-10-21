'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { RoomManager, GAMES } = require('./src/rooms');
const { GameError } = require('./src/errors');
const { openStore } = require('./src/community');
const contrib = require('./src/contrib');
const { openSurvey, roundRecord, toFeudQuestions } = require('./src/survey');
const { whoCategories } = require('./src/games/who');
const { limiter } = require('./src/limits');
const { openAccounts, hashPassword } = require('./src/accounts');
const { accountRouter, pictureRoute, accountFromCookie } = require('./src/web-accounts');
const banks = require('./src/banks');
const groups = require('./src/groups');
const { createOAuth } = require('./src/oauth');
const { mcpHandler } = require('./src/mcp');
const { categories } = require('./data/questions.json');
const timeCategories = require('./data/time-challenge.json').categories;
const seenCategories = require('./data/seen-jeem.json').categories;
// A game whose question file isn't there yet stays hidden from the game picker.
const optional = (file, key) => (fs.existsSync(path.join(__dirname, file)) ? require(`./${file}`)[key] : []);
const letters = optional('data/letters.json', 'letters');
const outsiderCategories = optional('data/outsider.json', 'categories');
const feudQuestions = optional('data/feud.json', 'questions');
const whoQuestions = optional('data/who.json', 'questions');

const PORT = Number(process.env.PORT) || 3000;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

const rooms = new RoomManager({
  categories, timeCategories, seenCategories, letters, outsiderCategories, feudQuestions, whoCategories: whoCategories(whoQuestions),
});

const app = express();
app.set('trust proxy', 1); // Render sits in front, so req.ip is the visitor's address
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// Country flags for «تحدي الوقت» (flag-icons, MIT).
app.use('/flags', express.static(path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags'), { maxAge: '7d' }));
// Card data for the preview page.
app.get('/time-challenge.json', (req, res) => res.json({ categories: timeCategories }));
app.get('/healthz', (req, res) => res.send('ok'));

/* ---------- «أضف أسئلة»: questions people send, approved by the owner ---------- */

// The banks as shipped; approved questions are added on top of these.
const BASE = { herd: categories, seen: seenCategories, letters, outsider: outsiderCategories };
let store = null;
let storeError = null;

async function refreshCommunity() {
  const approved = await store.list('approved');
  for (const [game, spec] of Object.entries(contrib.SPECS)) {
    const entries = approved.filter((a) => a.game === game).map((a) => a.payload);
    rooms.setContent(game, spec.merge(BASE[game], entries));
  }
}

async function openCommunity() {
  const file = process.env.COMMUNITY_FILE || path.join(__dirname, 'data', 'community.local.json');
  try {
    store = await openStore({ file });
  } catch (err) {
    console.error('Question database unavailable, using a local file:', err.message);
    storeError = 'ما قدرنا نتصل بقاعدة البيانات، والأسئلة تنحفظ مؤقتاً في ملف';
    store = await openStore({ databaseUrl: '', file });
  }
  await refreshCommunity();
}
const communityReady = openCommunity();

/* ---------- «استبيانكم»: «عقلية القطيع» answers become «فاميلي فيود» questions ---------- */

let survey = null;
let surveyReady = 0; // questions with enough answers to play
let surveyTimer = null;
async function refreshFeud() {
  const ready = toFeudQuestions(await survey.all());
  surveyReady = ready.length;
  rooms.setContent('feud', [...feudQuestions, ...ready]);
}
const surveyOpen = (async () => {
  const file = process.env.SURVEY_FILE || path.join(__dirname, 'data', 'local', 'survey.json');
  try {
    survey = await openSurvey({ file });
  } catch (err) {
    console.error('Survey database unavailable, using a local file:', err.message);
    survey = await openSurvey({ databaseUrl: '', file });
  }
  await refreshFeud();
})().catch((err) => console.error('[survey]', err.message));
rooms.onSurvey = (round) => {
  const record = roundRecord(round.question, round.groups);
  if (!record) return;
  surveyOpen
    .then(() => survey.record(record))
    .then(() => {
      // A batch of rounds finishing together refreshes the questions once.
      clearTimeout(surveyTimer);
      surveyTimer = setTimeout(() => refreshFeud().catch((err) => console.error('[survey]', err.message)), 3000);
      surveyTimer.unref?.();
    })
    .catch((err) => console.error('[survey]', err.message));
};

const submitLimit = limiter(50, 60 * 60 * 1000);
const loginLimit = limiter(10, 15 * 60 * 1000);
const draftLimit = limiter(30, 5 * 1000); // a phone sends its unsent answer as the player types
const MAX_ITEMS = 50;

const api = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
api.use(express.json({ limit: '64kb' }));
api.use((req, res, next) => {
  communityReady.then(() => next(), next);
});

api.get('/contrib/spec', (req, res) => res.json({ games: contrib.formSpec(rooms.content) }));

// «👥 الشلة»: the names in the room's group ranking, so a phone joining can pick its name instead of typing it.
api.get('/rooms/:code/names', (req, res) => res.json({ names: rooms.get(req.params.code)?.groupNames().slice(0, 40) ?? [] }));

/** Checks entries for one game and stores the good ones for review. Returns { added, errors }. */
async function submitEntries(game, items, submitter) {
  const spec = contrib.SPECS[game];
  const valid = [];
  const errors = [];
  const seen = new Set();
  items.forEach((item, index) => {
    try {
      const payload = spec.validate(item ?? {}, rooms.content[game] ?? []);
      const sig = JSON.stringify(payload);
      if (seen.has(sig)) throw new GameError('مكرر في نفس الإرسال');
      seen.add(sig);
      valid.push(payload);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      errors.push({ index, error: err.message });
    }
  });
  const name = String(submitter ?? '').trim().slice(0, 30) || null;
  await store.add(valid.map((payload) => ({ game, payload, submitter: name })));
  return { added: valid.length, errors };
}

api.post('/contrib', wrap(async (req, res) => {
  const { game, items, submitter } = req.body ?? {};
  if (!contrib.SPECS[game]) return res.status(400).json({ error: 'لعبة غير معروفة' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'ما فيه أسئلة' });
  if (items.length > MAX_ITEMS) return res.status(400).json({ error: `بالكثير ${MAX_ITEMS} سؤال في المرة` });
  if (!submitLimit(req.ip, Math.min(items.length, MAX_ITEMS))) return res.status(429).json({ error: 'أرسلت أسئلة كثير، جرّب بعد ساعة' });
  return res.json({ ok: true, ...(await submitEntries(game, items, submitter)) });
}));

// The review page: everything below needs the owner's password (ADMIN_PASSWORD).
const sha = (text) => require('crypto').createHash('sha256').update(String(text)).digest();
api.use('/admin', (req, res, next) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return res.status(503).json({ error: 'صفحة المراجعة مقفلة: حط ADMIN_PASSWORD في إعدادات السيرفر' });
  let given = '';
  try {
    given = decodeURIComponent(req.get('x-admin-password') ?? ''); // sent encoded, so Arabic passwords work
  } catch {
    given = '';
  }
  if (require('crypto').timingSafeEqual(sha(given), sha(password))) return next();
  if (!loginLimit(req.ip)) return res.status(429).json({ error: 'محاولات كثير، جرّب بعد ربع ساعة' });
  return res.status(401).json({ error: 'كلمة السر غلط' });
});

api.get('/admin/status', wrap(async (req, res) => {
  const all = await store.list();
  const count = (status) => all.filter((i) => i.status === status).length;
  const surveyQuestions = survey ? (await survey.all()).length : 0;
  res.json({
    storage: store.kind, persistent: store.persistent, error: storeError, pending: count('pending'), approved: count('approved'),
    survey: { questions: surveyQuestions, ready: surveyReady },
  });
}));

api.get('/admin/submissions', wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const items = (await store.list(status)).filter((i) => contrib.SPECS[i.game]);
  res.json({ items, games: contrib.formSpec(rooms.content) });
}));

api.post('/admin/submissions/:id/approve', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const item = (await store.list('pending')).find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: 'ما لقينا السؤال' });
  let payload;
  try {
    payload = contrib.SPECS[item.game].validate(req.body?.payload ?? item.payload, rooms.content[item.game] ?? []);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    return res.status(400).json({ error: err.message });
  }
  await store.decide(id, 'approved', payload);
  await refreshCommunity();
  return res.json({ ok: true });
}));

api.post('/admin/submissions/:id/reject', wrap(async (req, res) => {
  const done = await store.decide(Number(req.params.id), 'rejected');
  if (!done) return res.status(404).json({ error: 'ما لقينا السؤال' });
  return res.json({ ok: true });
}));

api.post('/admin/submissions/:id/delete', wrap(async (req, res) => {
  const done = await store.remove(Number(req.params.id));
  if (!done) return res.status(404).json({ error: 'ما لقينا السؤال' });
  await refreshCommunity();
  return res.json({ ok: true });
}));

/* ---------- Accounts, from the review page ---------- */

api.get('/admin/accounts', wrap(async (req, res) => {
  const accounts = await accountsReady;
  res.json({ accounts: await accounts.listAccounts(String(req.query.q ?? '')), persistent: accounts.persistent });
}));

api.post('/admin/accounts/:id/password', wrap(async (req, res) => {
  const password = String(req.body?.password ?? '');
  if (password.length < 8) return res.status(400).json({ error: 'كلمة السر 8 أحرف على الأقل' });
  const accounts = await accountsReady;
  const done = await accounts.setPassword(Number(req.params.id), await hashPassword(password));
  if (!done) return res.status(404).json({ error: 'ما لقينا الحساب' });
  // Logged out everywhere, AI apps included.
  await accounts.deleteSessions({ accountId: Number(req.params.id) });
  await accounts.deleteTokens({ accountId: Number(req.params.id) });
  return res.json({ ok: true });
}));

api.post('/admin/accounts/:id/delete', wrap(async (req, res) => {
  const accounts = await accountsReady;
  const done = await accounts.deleteAccount(Number(req.params.id));
  if (!done) return res.status(404).json({ error: 'ما لقينا الحساب' });
  return res.json({ ok: true });
}));

api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[api]', err);
  res.status(500).json({ error: 'صار خطأ، جرّب مرة ثانية' });
});

// Accounts and their question banks (the account page, and the AI over MCP).
const accountsDir = process.env.ACCOUNTS_DIR || path.join(__dirname, 'data', 'local');
const accountsReady = openAccounts({ dir: accountsDir }).catch(async (err) => {
  console.error('Accounts database unavailable, using local files:', err.message);
  return openAccounts({ databaseUrl: '', dir: accountsDir });
});
app.use('/api/account', accountRouter({
  accountsReady,
  content: () => rooms.content,
  community: { submit: async (game, entries, submitter) => { await communityReady; return submitEntries(game, entries, submitter); } },
  games: () => Object.entries(GAMES).filter(([, g]) => g.needsContent !== false).map(([id, g]) => ({ id, name: g.name, emoji: g.emoji })),
}));

// «👥 الشلة»: what each group has had, written one after another so a section starting over
// and the next question played land in order; picking a group waits for them.
let groupWrites = Promise.resolve();
const writeGroups = (fn) => {
  groupWrites = groupWrites.then(() => accountsReady).then(fn).catch((err) => console.error('[groups]', err.message));
};
rooms.onGroupPlay = (groupId, game, keys) => writeGroups((store) => store.addGroupPlays(groupId, game, keys));
rooms.onGroupRecycle = (groupId, game, keys) => writeGroups((store) => store.removeGroupPlays(groupId, game, keys));
rooms.onGroupScore = (groupId, rows) => writeGroups((store) => store.addGroupScores(groupId, rows));
/** The lobby's list: the account's own groups, and the ones it's in (with the owner's name). */
const lobbyGroups = async (store, accountId) => (await store.listGroups(accountId))
  .map((g) => ({ id: g.id, name: g.name, owner: g.accountId === accountId ? null : g.ownerName }));
app.get('/bank-img/:id.webp', pictureRoute(accountsReady));

// MCP: Claude, ChatGPT and other AI apps log in to an account (OAuth) and add banks through /mcp.
const BASE_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
// OAuth needs an https address (or localhost for trying it out); AI apps couldn't reach a LAN address anyway.
const base = new URL(BASE_URL);
if (base.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(base.hostname)) {
  const oauth = createOAuth({ accountsReady, baseUrl: BASE_URL });
  app.use(oauth.router);
  app.use('/oauth', oauth.consent);
  app.post('/mcp', oauth.bearer, express.json({ limit: '10mb' }), mcpHandler({ accountsReady, content: () => rooms.content, baseUrl: BASE_URL }));
  app.all('/mcp', (req, res) => res.status(405).set('allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
} else {
  console.warn(`MCP is off: it needs an https PUBLIC_URL (now ${BASE_URL}).`);
  app.all('/mcp', (req, res) => res.status(503).json({ jsonrpc: '2.0', error: { code: -32000, message: 'MCP needs the site on https.' }, id: null }));
}
app.use('/api', api);

const server = http.createServer(app);
const io = new Server(server);

const hostChannel = (code) => `${code}:host`;
const playerChannel = (code, playerId) => `${code}:player:${playerId}`;

function broadcast(room) {
  room.settleNight();
  io.to(hostChannel(room.code)).emit('host:state', room.hostView());
  for (const id of room.players.keys()) {
    io.to(playerChannel(room.code, id)).emit('player:state', room.playerView(id));
  }
}

function lanAddress() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  const isPrivate = (ip) => /^(10|192\.168)\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return addresses.find(isPrivate) || addresses[0] || null;
}

/**
 * The address phones should open. A host browsing on localhost gets the
 * machine's Wi-Fi address instead, since "localhost" on a phone is the phone.
 * Render provides RENDER_EXTERNAL_URL with the service's public address.
 */
function publicBaseUrl(handshake) {
  const configured = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const { headers } = handshake;
  const first = (value) => String(value).split(',')[0].trim();
  const host = first(headers['x-forwarded-host'] || headers.host || `localhost:${PORT}`);
  const proto = first(headers['x-forwarded-proto'] || (handshake.secure ? 'https' : 'http'));
  const { hostname, port } = new URL(`${proto}://${host}`);
  if (LOCAL_HOSTNAMES.has(hostname)) {
    const ip = lanAddress();
    if (ip) return `http://${ip}${port ? `:${port}` : ''}`;
  }
  return `${proto}://${host}`;
}

async function joinInfo(room, handshake) {
  const joinUrl = `${publicBaseUrl(handshake)}/play?room=${room.code}`;
  const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { joinUrl, qrSvg };
}

io.on('connection', (socket) => {
  socket.data = {};

  const on = (event, handler) => {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, ...(await handler(payload || {})) });
      } catch (err) {
        if (!(err instanceof GameError)) console.error(`[${event}]`, err);
        reply({ ok: false, error: err instanceof GameError ? err.message : 'صار خطأ، جرّب مرة ثانية' });
      }
    });
  };

  function leaveCurrent() {
    const { role, code, playerId } = socket.data;
    socket.data = {};
    if (!code) return;
    const room = rooms.get(code);
    if (role === 'host') socket.leave(hostChannel(code));
    if (role === 'player') {
      socket.leave(playerChannel(code, playerId));
      if (room) {
        room.disconnect(playerId, socket.id);
        broadcast(room);
      }
    }
  }

  /** The host's account (from the site's login cookie) owns the room's «بنوكي». */
  async function loadOwner(room) {
    const store = await accountsReady;
    const account = await accountFromCookie(store, socket.handshake.headers.cookie);
    if (!account) return;
    room.ownerId = account.id;
    room.ownerName = account.username;
    room.bankList = (await store.listBanks(account.id)).map(banks.summary);
    room.groupList = await lobbyGroups(store, account.id);
  }

  async function attachHost(room) {
    await loadOwner(room).catch((err) => console.error('[owner]', err.message));
    leaveCurrent();
    socket.data = { role: 'host', code: room.code };
    socket.join(hostChannel(room.code));
    const info = await joinInfo(room, socket.handshake);
    // «📱 تحكم من جوالك»: the same host screen on the host's own phone (it carries the host key).
    const remoteUrl = `${publicBaseUrl(socket.handshake)}/host?code=${room.code}&token=${room.hostToken}&remote=1`;
    const remoteQrSvg = await QRCode.toString(remoteUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    socket.emit('host:state', room.hostView());
    return { code: room.code, hostToken: room.hostToken, ...info, remoteUrl, remoteQrSvg };
  }

  function currentRoom(role) {
    const room = socket.data.role === role && rooms.get(socket.data.code);
    if (!room) throw new GameError('الغرفة انتهت');
    if (role === 'player' && !room.players.has(socket.data.playerId)) {
      throw new GameError('أنت مو داخل الغرفة');
    }
    room.touch();
    return room;
  }

  const hostAction = (event, action) => {
    on(event, (payload) => {
      const room = currentRoom('host');
      action(room, payload);
      broadcast(room);
    });
  };

  on('host:create', ({ gameType }) => {
    const room = rooms.create();
    if (room.games().some((g) => g.id === gameType)) room.setGameType(gameType);
    room.onChange = () => broadcast(room);
    return attachHost(room);
  });

  on('host:resume', ({ code, hostToken }) => {
    const room = rooms.get(code);
    if (!room || room.hostToken !== hostToken) throw new GameError('الغرفة انتهت');
    room.touch();
    return attachHost(room);
  });

  // Shared by every game.
  hostAction('host:game-type', (room, { gameType }) => room.setGameType(gameType));
  hostAction('host:settings', (room, settings) => room.game.updateSettings(settings));
  hostAction('host:start', (room, options) => room.game.start(options));
  hostAction('host:next', (room, { step }) => room.game.next(step));
  hostAction('host:end', (room) => room.game.finish());
  hostAction('host:restart', (room) => room.game.restart());
  // «بطل السهرة»
  hostAction('host:night-crown', (room, { on }) => room.night.crown(on));
  hostAction('host:night-reset', (room) => room.night.reset());
  // The team games («تحدي الوقت», «سين جيم»).
  const teamGame = (room) => {
    if (!room.game.setTeam) throw new GameError('هذي اللعبة ما فيها فرق');
    return room.game;
  };
  hostAction('host:team', (room, { playerId, team }) => teamGame(room).setTeam(playerId, team));
  hostAction('host:shuffle', (room) => teamGame(room).shuffleTeams());
  hostAction('host:kick', (room, { playerId }) => {
    room.kick(playerId);
    const channel = playerChannel(room.code, playerId);
    io.to(channel).emit('player:kicked');
    io.in(channel).socketsLeave(channel);
  });

  // «عقلية القطيع»
  const herd = (room) => room.gameOf('herd');
  hostAction('host:reveal', (room) => herd(room).reveal());
  hostAction('host:merge', (room, { from, to }) => herd(room).merge(from, to));
  hostAction('host:reject', (room, { groupId }) => herd(room).toggleReject(groupId));
  hostAction('host:undo', (room) => herd(room).undo());
  hostAction('host:vote-start', (room, { groupId }) => room.startVote(groupId));
  hostAction('host:vote-end', (room) => herd(room).finishVote());
  hostAction('host:vote-cancel', (room) => herd(room).cancelVote());
  hostAction('host:vote-decide', (room, { reject }) => herd(room).decideTie(reject));
  hostAction('host:confirm', (room) => herd(room).confirm());

  // «تحدي الوقت»
  const time = (room) => room.gameOf('time');
  hostAction('host:tc-spin', (room) => time(room).spin());
  hostAction('host:tc-go', (room) => time(room).go());
  hostAction('host:tc-player', (room, { team, playerId }) => time(room).setPlayer(team, playerId));
  hostAction('host:tc-correct', (room, { step }) => time(room).correct(step));
  hostAction('host:tc-skip', (room, { step }) => time(room).skip(step));
  hostAction('host:tc-pause', (room, { step }) => time(room).pause(step));
  hostAction('host:tc-resume', (room, { step }) => time(room).resume(step));
  hostAction('host:tc-undo', (room, { step }) => time(room).undo(step));
  hostAction('host:tc-exclude', (room, { step }) => time(room).exclude(step));

  // «سين جيم»
  const seen = (room) => room.gameOf('seen');
  hostAction('host:sj-pick', (room, { tileId, step }) => seen(room).pick(tileId, step));
  hostAction('host:sj-cancel', (room, { step }) => seen(room).cancelPick(step));
  hostAction('host:sj-lifeline', (room, { name, step }) => seen(room).lifeline(name, step));
  hostAction('host:sj-show', (room, { step }) => seen(room).showQuestion(step));
  hostAction('host:sj-judge', (room, { correct, step }) => seen(room).judge(Boolean(correct), step));
  hostAction('host:sj-undo', (room, { step }) => seen(room).undo(step));
  hostAction('host:sj-next', (room, { step }) => seen(room).next(step));

  // «حروف»
  const hr = (room) => room.gameOf('letters');
  hostAction('host:hr-pick', (room, { cell, step }) => hr(room).pick(Number(cell), step));
  hostAction('host:hr-buzz', (room, { team, step }) => hr(room).hostBuzz(team, step));
  hostAction('host:hr-judge', (room, { correct, step }) => hr(room).judge(Boolean(correct), step));
  hostAction('host:hr-new', (room, { step }) => hr(room).newQuestion(step));
  hostAction('host:hr-release', (room, { step }) => hr(room).release(step));
  hostAction('host:hr-undo', (room, { step }) => hr(room).undo(step));
  hostAction('host:hr-next', (room, { step }) => hr(room).next(step));

  // «بنوكي»: the host's own banks, switched on per game.
  on('host:banks', async ({ ids }) => {
    const room = currentRoom('host');
    if (!room.ownerId) throw new GameError('سجّل دخول عشان تستخدم بنوكك');
    const list = await banks.playableContent(await accountsReady, room.ownerId, room.gameType, Array.isArray(ids) ? ids : []);
    room.useBanks(list);
    broadcast(room);
  });
  on('host:banks-refresh', async () => {
    const room = currentRoom('host');
    await loadOwner(room);
    if (room.ownerId) {
      const store = await accountsReady;
      for (const [game, ids] of Object.entries(room.bankOn)) {
        const list = await banks.playableContent(store, room.ownerId, game, ids);
        room.bankOn[game] = list.map((x) => x.bank.id);
        room.bankContent[game] = list.map((x) => x.content);
      }
      if (['lobby', 'final'].includes(room.game.phase)) room.applyBanks();
    }
    broadcast(room);
  });

  // «👥 الشلة»: the group playing tonight, so the questions it has had don't come back.
  const groupRoom = () => {
    const room = currentRoom('host');
    if (!room.ownerId) throw new GameError('سجّل دخول عشان تحفظ شلتك');
    if (!['lobby', 'final'].includes(room.game.phase)) throw new GameError('خلّص اللعبة الحالية أول');
    return room;
  };
  on('host:group', async ({ id = null } = {}) => {
    const room = groupRoom();
    if (id == null) room.setGroup(null);
    else {
      await groupWrites;
      room.setGroup(await groups.load(await accountsReady, room.ownerId, id));
    }
    broadcast(room);
  });
  on('host:group-create', async ({ name } = {}) => {
    const room = groupRoom();
    const store = await accountsReady;
    const group = await groups.create(store, room.ownerId, name);
    room.groupList = await lobbyGroups(store, room.ownerId);
    room.setGroup({ id: group.id, name: group.name, plays: {} });
    broadcast(room);
  });

  // «فاميلي فيود»
  const ff = (room) => room.gameOf('feud');
  hostAction('host:ff-buzz', (room, { team, step }) => ff(room).hostBuzz(team, step));
  hostAction('host:ff-reveal', (room, { slot, step }) => ff(room).reveal(slot, step));
  hostAction('host:ff-miss', (room, { step }) => ff(room).miss(step));
  hostAction('host:ff-choose', (room, { play, step }) => ff(room).choose(Boolean(play), step));
  hostAction('host:ff-undo', (room, { step }) => ff(room).undo(step));
  hostAction('host:ff-fast-player', (room, { index, playerId, step }) => ff(room).setFastPlayer(index, playerId, step));
  hostAction('host:ff-fast-start', (room, { step }) => ff(room).startFast(step));
  hostAction('host:ff-fast-mark', (room, { stage, index, slot, step }) => ff(room).fastMark(stage, index, slot ?? null, step));

  // «برا السالفة»
  const os = (room) => room.gameOf('outsider');
  hostAction('host:os-begin', (room, { step }) => os(room).begin(step));
  hostAction('host:os-next', (room, { step }) => os(room).nextAsker(step));
  hostAction('host:os-vote', (room, { step }) => os(room).openVote(step));
  hostAction('host:os-close', (room, { step }) => os(room).closeVote(step));
  hostAction('host:os-skip-guess', (room, { step }) => os(room).skipGuess(step));

  // «مين فينا؟»
  hostAction('host:who-reveal', (room, { step }) => room.gameOf('who').reveal(step));

  // «مافيا»
  const mf = (room) => room.gameOf('mafia');
  hostAction('host:mf-night', (room, { step }) => mf(room).startNight(step));
  hostAction('host:mf-end-night', (room, { step }) => mf(room).endNight(step));
  hostAction('host:mf-discuss', (room, { step }) => mf(room).startDiscussion(step));
  hostAction('host:mf-vote', (room, { step }) => mf(room).startVote(step));
  hostAction('host:mf-end-vote', (room, { step }) => mf(room).endVote(step));

  on('player:join', ({ code, name, playerId }) => {
    const room = rooms.get(code);
    if (!room) throw new GameError('ما لقينا الغرفة، تأكد من الرقم');
    room.touch();
    const player = room.join({ name, playerId });
    leaveCurrent();
    socket.data = { role: 'player', code: room.code, playerId: player.id };
    socket.join(playerChannel(room.code, player.id));
    room.connect(player.id, socket.id);
    broadcast(room);
    return { code: room.code, playerId: player.id, name: player.name };
  });

  on('player:answer', (answer) => {
    const room = currentRoom('player');
    room.submitAnswer(socket.data.playerId, answer);
    broadcast(room);
  });

  // «عقلية القطيع»: what a phone has typed, so it's sent for them if time runs out. Quiet: no broadcast, no errors.
  socket.on('player:draft', (draft) => {
    const { code, role, playerId } = socket.data ?? {};
    if (role !== 'player' || !draftLimit(`${code}:${playerId}`)) return;
    rooms.get(code)?.saveDraft(playerId, draft && typeof draft === 'object' ? draft : {});
  });

  on('player:ff-buzz', () => {
    const room = currentRoom('player');
    room.gameOf('feud').buzz(socket.data.playerId);
    broadcast(room);
  });

  // «المال السريع»: the player's five answers as they type (the ack says which repeat the first player's).
  on('player:ff-fast', ({ answers, done } = {}) => {
    const room = currentRoom('player');
    const game = room.gameOf('feud');
    const out = game.fastUpdate(socket.data.playerId, answers);
    if (done) game.fastDone(socket.data.playerId);
    if (done || out.duplicates.length) broadcast(room);
    return out;
  });

  on('player:buzz', () => {
    const room = currentRoom('player');
    const first = room.gameOf('letters').buzz(socket.data.playerId);
    if (first) broadcast(room);
    return { first };
  });

  on('player:os-vote', ({ target }) => {
    const room = currentRoom('player');
    room.outsiderVote(socket.data.playerId, target);
    broadcast(room);
  });

  on('player:os-guess', ({ word }) => {
    const room = currentRoom('player');
    room.gameOf('outsider').guess(socket.data.playerId, word);
    broadcast(room);
  });

  on('player:mf-pick', ({ target }) => {
    const room = currentRoom('player');
    room.mafiaPick(socket.data.playerId, target ?? null);
    broadcast(room);
  });

  on('player:mf-confirm', () => {
    const room = currentRoom('player');
    room.mafiaConfirm(socket.data.playerId);
    broadcast(room);
  });

  on('player:mf-vote', ({ target }) => {
    const room = currentRoom('player');
    room.mafiaVote(socket.data.playerId, target);
    broadcast(room);
  });

  on('player:who-vote', ({ target }) => {
    const room = currentRoom('player');
    room.whoVote(socket.data.playerId, target);
    broadcast(room);
  });

  on('player:vote', ({ choice }) => {
    const room = currentRoom('player');
    room.castVote(socket.data.playerId, choice);
    broadcast(room);
  });

  socket.on('disconnect', leaveCurrent);
});

setInterval(() => rooms.cleanup(), 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  const ip = lanAddress();
  console.log(`🎮 السيرفر شغّال: http://localhost:${PORT}`);
  if (ip) console.log(`📱 من الجوالات على نفس الشبكة: http://${ip}:${PORT}`);
});
