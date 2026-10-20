'use strict';

// The account pages' API (/api/account/*), the session cookie, and the bank
// pictures (/bank-img/:id.webp). Requests are JSON only, and the cookie is
// SameSite=Lax, so other sites can't make a logged-in browser call these.

const express = require('express');
const { GameError } = require('./errors');
const { hashPassword, checkPassword, sha256, token, USERNAME, MIN_PASSWORD } = require('./accounts');
const banks = require('./banks');
const groups = require('./groups');
const { limiter } = require('./limits');
const { NEW } = require('./contrib');

const COOKIE = 'gs_session';
const SESSION_DAYS = 90;

function cookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** The account logged in on this browser, from the session cookie (also used for socket handshakes). */
async function accountFromCookie(accounts, cookieHeader) {
  const raw = cookies(cookieHeader)[COOKIE];
  if (!raw || !accounts) return null;
  const session = await accounts.getSession(sha256(raw));
  return session ? accounts.getAccount(session.accountId) : null;
}

async function startSession(accounts, req, res, accountId) {
  const raw = token();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await accounts.addSession(sha256(raw), accountId, expires);
  res.cookie(COOKIE, raw, { httpOnly: true, sameSite: 'lax', secure: req.secure, expires, path: '/' });
}

/** Turns a bank's items into entries for «أضف أسئلة», so the owner can share it with everyone. */
function shareEntries(bank, { subcategory } = {}) {
  const textOnly = bank.items.filter((i) => !i.img);
  switch (bank.game) {
    case 'seen': return textOnly.map((i) => ({ category: NEW, newName: bank.name, newEmoji: bank.emoji, value: i.value, q: i.q, a: i.a }));
    case 'letters': return textOnly.map(({ q, a }) => ({ q, a }));
    case 'herd':
      if (!subcategory) throw new GameError('اختر القسم اللي تروح له الأسئلة');
      return textOnly.map(({ mode, q }) => ({ subcategory, mode, q }));
    case 'outsider': return textOnly.map(({ word }) => ({ category: NEW, newName: bank.name, newEmoji: bank.emoji, word }));
    default: throw new GameError('بنوك «تحدي الوقت» ما تنرسل للكل حالياً');
  }
}

/**
 * accounts: the account store (a promise while it opens); content(): the games' public banks;
 * community: { submit(game, entries, submitter) } for sharing.
 */
/** games(): [{ id, name, emoji }], for naming what each «👥 الشلة» group has played. */
function accountRouter({ accountsReady, content, community, games = () => [] }) {
  const router = express.Router();
  const signupLimit = limiter(5, 60 * 60 * 1000);
  const loginLimit = limiter(10, 15 * 60 * 1000);
  let accounts = null;
  const ready = accountsReady.then((store) => { accounts = store; });
  const wrap = (fn) => (req, res, next) => ready.then(() => fn(req, res)).catch(next);

  router.use(express.json({ limit: '2mb' }));
  router.use((req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'JSON بس' });
    return next();
  });
  const me = async (req) => accountFromCookie(accounts, req.headers.cookie);
  const mine = (fn) => wrap(async (req, res) => {
    const account = await me(req);
    if (!account) return res.status(401).json({ error: 'سجّل دخول أول' });
    return fn(req, res, account);
  });

  router.get('/me', wrap(async (req, res) => {
    res.json({ account: await me(req), persistent: accounts.persistent });
  }));

  router.post('/signup', wrap(async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!USERNAME.test(username)) return res.status(400).json({ error: 'اسم المستخدم من 3 إلى 20 حرف أو رقم (بدون مسافات)' });
    if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `كلمة السر ${MIN_PASSWORD} أحرف على الأقل` });
    if (!signupLimit(req.ip)) return res.status(429).json({ error: 'سويت حسابات كثير، جرّب بعد ساعة' });
    const account = await accounts.createAccount(username, await hashPassword(password));
    if (!account) return res.status(409).json({ error: 'الاسم مأخوذ، اختر اسم ثاني' });
    await startSession(accounts, req, res, account.id);
    return res.json({ account });
  }));

  router.post('/login', wrap(async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    if (!loginLimit(`${req.ip}:${username.toLowerCase()}`)) return res.status(429).json({ error: 'محاولات كثير، جرّب بعد ربع ساعة' });
    const found = await accounts.findAccount(username);
    if (!found || !(await checkPassword(String(req.body?.password ?? ''), found.passwordHash))) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غلط' });
    }
    await startSession(accounts, req, res, found.id);
    return res.json({ account: await accounts.getAccount(found.id) });
  }));

  router.post('/logout', wrap(async (req, res) => {
    const raw = cookies(req.headers.cookie)[COOKIE];
    if (raw) await accounts.deleteSessions({ hash: sha256(raw) });
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  router.post('/password', mine(async (req, res, account) => {
    const found = await accounts.findAccount(account.username);
    if (!(await checkPassword(String(req.body?.current ?? ''), found.passwordHash))) return res.status(401).json({ error: 'كلمة السر الحالية غلط' });
    const next = String(req.body?.next ?? '');
    if (next.length < MIN_PASSWORD) return res.status(400).json({ error: `كلمة السر ${MIN_PASSWORD} أحرف على الأقل` });
    await accounts.setPassword(account.id, await hashPassword(next));
    return res.json({ ok: true });
  }));

  router.get('/banks', mine(async (req, res, account) => {
    const list = await accounts.listBanks(account.id);
    res.json({
      banks: list.map(banks.summary),
      games: Object.entries(banks.GAMES).map(([id, g]) => ({ id, name: g.name, emoji: g.emoji, unit: g.unit, paste: g.paste, prompt: banks.pastePrompt(id) })),
      limits: banks.LIMITS,
    });
  }));

  router.get('/banks/:id', mine(async (req, res, account) => {
    const bank = await accounts.getBank(Number(req.params.id));
    if (!bank || bank.accountId !== account.id) return res.status(404).json({ error: 'ما لقينا البنك' });
    return res.json({ bank: { ...banks.summary(bank), items: bank.items.map((i) => (i.img ? { ...i, img: `/bank-img/${i.img}.webp` } : i)) } });
  }));

  const addFromText = (bankIdOf) => mine(async (req, res, account) => {
    const bankId = bankIdOf(req);
    let game = req.body?.game;
    if (bankId) game = (await accounts.getBank(bankId))?.game;
    const spec = banks.GAMES[game];
    if (!spec) return res.status(400).json({ error: 'اختر اللعبة' });
    const items = spec.parseText(req.body?.text);
    if (!items.length) return res.status(400).json({ error: 'ما لقينا شي في النص' });
    const out = await banks.addItems(accounts, account.id, { game, bankId, name: req.body?.name, emoji: req.body?.emoji, items }, content()[game] ?? []);
    return res.json(out);
  });
  router.post('/banks', addFromText(() => null));
  router.post('/banks/:id/items', addFromText((req) => Number(req.params.id)));

  router.post('/banks/:id/remove', mine(async (req, res, account) => {
    res.json(await banks.removeItems(accounts, account.id, req.params.id, Array.isArray(req.body?.ids) ? req.body.ids : []));
  }));

  router.post('/banks/:id/delete', mine(async (req, res, account) => {
    res.json(await banks.deleteBank(accounts, account.id, req.params.id));
  }));

  router.post('/banks/:id/share', mine(async (req, res, account) => {
    const bank = await accounts.getBank(Number(req.params.id));
    if (!bank || bank.accountId !== account.id) return res.status(404).json({ error: 'ما لقينا البنك' });
    const entries = shareEntries(bank, { subcategory: req.body?.subcategory });
    if (!entries.length) return res.status(400).json({ error: 'ما فيه أسئلة نصية ترسلها' });
    const out = await community.submit(bank.game, entries.slice(0, 200), account.username);
    return res.json({ ...out, skipped: bank.items.length - entries.length });
  }));

  // «👥 الشلة»: the groups the account plays with, and the questions each has had.
  router.get('/groups', mine(async (req, res, account) => {
    res.json({ groups: await groups.list(accounts, account.id), games: games(), limits: groups.LIMITS });
  }));

  router.post('/groups', mine(async (req, res, account) => {
    res.json({ group: await groups.create(accounts, account.id, req.body?.name) });
  }));

  router.post('/groups/:id/rename', mine(async (req, res, account) => {
    res.json({ group: await groups.rename(accounts, account.id, req.params.id, req.body?.name) });
  }));

  router.post('/groups/:id/reset', mine(async (req, res, account) => {
    await groups.reset(accounts, account.id, req.params.id);
    res.json({ ok: true });
  }));

  router.post('/groups/:id/delete', mine(async (req, res, account) => {
    await groups.remove(accounts, account.id, req.params.id);
    res.json({ ok: true });
  }));

  router.get('/connections', mine(async (req, res, account) => {
    res.json({ connections: await accounts.listConnections(account.id) });
  }));

  router.post('/connections/:clientId/revoke', mine(async (req, res, account) => {
    await accounts.deleteTokens({ accountId: account.id, clientId: req.params.clientId });
    res.json({ ok: true });
  }));

  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof GameError) return res.status(400).json({ error: err.message });
    console.error('[account]', err);
    return res.status(500).json({ error: 'صار خطأ، جرّب مرة ثانية' });
  });
  return router;
}

/** Bank pictures, by their unguessable id. */
function pictureRoute(accountsReady) {
  return async (req, res, next) => {
    try {
      const store = await accountsReady;
      const data = /^[0-9a-f]{24}$/.test(req.params.id) ? await store.getImage(req.params.id) : null;
      if (!data) return res.status(404).end();
      res.set({ 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(data);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { accountRouter, pictureRoute, accountFromCookie, startSession, cookies, COOKIE };
