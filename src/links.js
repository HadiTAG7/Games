'use strict';

// «اربط حسابك»: every MCP conversation works in the account of whoever opens
// its link and logs in. An app's OAuth connection can be shared (one Claude
// account for a few people, or a connection set up once for an organization),
// so the connection alone doesn't say whose banks to fill; the link does.
// The AI gets a link_id from link_account, shows the person the link, and
// passes the link_id with every bank tool.

const express = require('express');
const { sha256, token } = require('./accounts');
const { checkLogin } = require('./web-accounts');
const { limiter } = require('./limits');
const { GameError } = require('./errors');

const WAIT_MS = 15 * 60 * 1000; // to open the link and log in
const LINKED_MS = 30 * 24 * 60 * 60 * 1000; // a linked conversation keeps working this long

const NOT_LINKED = 'This conversation is not linked to the person\'s account yet. Call link_account, show them the link_url, '
  + 'and once they say they\'ve logged in, call check_link; then pass that link_id with every bank tool.';

/** A new link for one conversation, waiting for someone to open it and log in. Returns its id (the secret in the link). */
async function createLink(store, { grantAccountId, clientName = null }) {
  const id = token();
  await store.addLink({ hash: sha256(id), grantAccountId, clientName, expiresAt: new Date(Date.now() + WAIT_MS) });
  return id;
}

/** The link behind a link_id, if it belongs to this OAuth connection. */
async function findLink(store, linkId, grantAccountId) {
  const link = linkId ? await store.getLink(sha256(String(linkId))) : null;
  return link && link.grantAccountId === grantAccountId ? link : null;
}

/** The account a conversation works in; otherwise an error that tells the AI what to do. */
async function linkedAccount(store, linkId, grantAccountId) {
  const link = await findLink(store, linkId, grantAccountId);
  if (!link) throw new GameError(NOT_LINKED);
  if (!link.accountId) throw new GameError('The person hasn\'t logged in on the link yet. Ask them to open link_url and log in with their own account, then call check_link.');
  return link.accountId;
}

/** The link page's API: what's being asked, and the login that answers it. */
function linkRouter({ accountsReady }) {
  const router = express.Router();
  router.use(express.json({ limit: '8kb' }));
  const loginLimit = limiter(10, 15 * 60 * 1000);
  const GONE = 'الرابط انتهى، اطلب من Claude رابط جديد';
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

  router.get('/info', wrap(async (req, res) => {
    const link = await (await accountsReady).getLink(sha256(String(req.query.code ?? '')));
    if (!link) return res.status(404).json({ error: GONE });
    return res.json({ client: link.clientName || 'تطبيق ذكاء اصطناعي', linked: Boolean(link.accountId) });
  }));

  router.post('/confirm', wrap(async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON بس' });
    const store = await accountsReady;
    const hash = sha256(String(req.body?.code ?? ''));
    const link = await store.getLink(hash);
    if (!link) return res.status(404).json({ error: GONE });
    if (link.accountId) return res.status(409).json({ error: 'الرابط هذا مستخدم، اطلب من Claude رابط جديد' });
    const username = String(req.body?.username ?? '').trim();
    if (!loginLimit(`${req.ip}:${username.toLowerCase()}`)) return res.status(429).json({ error: 'محاولات كثير، جرّب بعد ربع ساعة' });
    const account = await checkLogin(store, username, req.body?.password);
    if (!account) return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غلط' });
    if (!(await store.confirmLink(hash, account.id, new Date(Date.now() + LINKED_MS)))) {
      return res.status(409).json({ error: 'الرابط هذا مستخدم، اطلب من Claude رابط جديد' });
    }
    return res.json({ username: account.username });
  }));

  return router;
}

module.exports = { createLink, findLink, linkedAccount, linkRouter, WAIT_MS, LINKED_MS, NOT_LINKED };
