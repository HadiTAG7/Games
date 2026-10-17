'use strict';

// Logging in to the site from Claude or ChatGPT, the way MCP expects
// (OAuth 2.1 with PKCE and dynamic client registration). The official MCP
// SDK serves the standard endpoints (/authorize, /token, /register, the
// .well-known metadata); this file supplies the parts that are ours: the
// consent page («تسمح لـClaude…؟»), and codes and tokens tied to an account.

const express = require('express');
const { mcpAuthRouter } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { InvalidTokenError, InvalidGrantError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const { sha256, token } = require('./accounts');
const { accountFromCookie } = require('./web-accounts');

const PENDING_MS = 10 * 60 * 1000; // to log in and allow
const CODE_MS = 5 * 60 * 1000;
const ACCESS_SECONDS = 60 * 60;
const REFRESH_MS = 90 * 24 * 60 * 60 * 1000;
// A used refresh token keeps working this long, so a retried request (say the
// reply got lost) doesn't cut the app off. Tests shorten it.
const REFRESH_GRACE_MS = Number(process.env.OAUTH_REFRESH_GRACE_MS) || 2 * 60 * 1000;
const SCOPE = 'banks';

function createOAuth({ accountsReady, baseUrl }) {
  const mcpUrl = new URL('/mcp', baseUrl);
  const pending = new Map(); // request id → { client, params, expires }
  const codes = new Map(); // code → { clientId, accountId, challenge, redirectUri, scopes, resource, expires }
  const sweep = () => {
    const now = Date.now();
    for (const map of [pending, codes]) for (const [k, v] of map) if (v.expires < now) map.delete(k);
  };

  async function issue(accountId, clientId, scopes, resource) {
    const store = await accountsReady;
    const access = token();
    const refresh = token();
    const base = { accountId, clientId, scopes, resource: resource ?? null };
    await store.addToken({ ...base, hash: sha256(access), kind: 'access', expiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000) });
    await store.addToken({ ...base, hash: sha256(refresh), kind: 'refresh', expiresAt: new Date(Date.now() + REFRESH_MS) });
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: scopes.join(' ') };
  }

  const provider = {
    clientsStore: {
      // Secrets don't expire (apps registered while they did get the same), or the app is cut off after a month.
      getClient: async (id) => {
        const client = await (await accountsReady).getClient(id);
        if (!client) return undefined;
        return client.client_secret ? { ...client, client_secret_expires_at: 0 } : client;
      },
      registerClient: async (client) => (await accountsReady).saveClient(client),
    },

    /** Sends the browser to our consent page, which logs in if needed and asks «تسمح؟». */
    async authorize(client, params, res) {
      sweep();
      if (params.resource && params.resource.origin !== mcpUrl.origin) {
        const back = new URL(params.redirectUri);
        back.searchParams.set('error', 'invalid_target');
        if (params.state) back.searchParams.set('state', params.state);
        res.redirect(back.href);
        return;
      }
      const id = token();
      pending.set(id, { client, params, expires: Date.now() + PENDING_MS });
      res.redirect(`/oauth/consent?req=${encodeURIComponent(id)}`);
    },

    async challengeForAuthorizationCode(client, code) {
      const c = codes.get(code);
      if (!c || c.clientId !== client.client_id || c.expires < Date.now()) throw new InvalidGrantError('Invalid authorization code');
      return c.challenge;
    },

    async exchangeAuthorizationCode(client, code, verifier, redirectUri) {
      const c = codes.get(code);
      codes.delete(code); // one use only
      if (!c || c.clientId !== client.client_id || c.expires < Date.now()) throw new InvalidGrantError('Invalid authorization code');
      if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri does not match');
      return issue(c.accountId, client.client_id, c.scopes, c.resource);
    },

    /** Each use of a refresh token hands out a new pair; the used one dies after a short grace period. */
    async exchangeRefreshToken(client, refreshToken) {
      const store = await accountsReady;
      const t = await store.getToken(sha256(refreshToken));
      if (!t || t.kind !== 'refresh' || t.clientId !== client.client_id) throw new InvalidGrantError('Invalid refresh token');
      const graceEnd = new Date(Date.now() + REFRESH_GRACE_MS);
      if (t.expiresAt > graceEnd) await store.setTokenExpiry(t.hash, graceEnd);
      return issue(t.accountId, client.client_id, t.scopes, t.resource);
    },

    async verifyAccessToken(accessToken) {
      const t = await (await accountsReady).getToken(sha256(accessToken));
      if (!t || t.kind !== 'access') throw new InvalidTokenError('Invalid or expired token');
      return {
        token: accessToken,
        clientId: t.clientId,
        scopes: t.scopes ?? [],
        expiresAt: Math.floor(t.expiresAt.getTime() / 1000),
        resource: t.resource ? new URL(t.resource) : undefined,
        extra: { accountId: t.accountId },
      };
    },

    async revokeToken(client, request) {
      const store = await accountsReady;
      const t = await store.getToken(sha256(request.token));
      if (t && t.clientId === client.client_id) await store.deleteTokens({ hash: t.hash });
    },
  };

  /** The consent page's API: what's being asked, and the answer. */
  const consent = express.Router();
  consent.use(express.json({ limit: '8kb' }));

  consent.get('/request', async (req, res, next) => {
    try {
      const p = pending.get(String(req.query.req ?? ''));
      if (!p || p.expires < Date.now()) return res.status(404).json({ error: 'الطلب انتهى، ارجع للتطبيق وجرّب الربط مرة ثانية' });
      const account = await accountFromCookie(await accountsReady, req.headers.cookie);
      return res.json({
        client: { name: p.client.client_name || 'تطبيق', host: new URL(p.params.redirectUri).host },
        account: account ? { username: account.username } : null,
      });
    } catch (err) {
      return next(err);
    }
  });

  consent.post('/decision', async (req, res, next) => {
    try {
      if (!req.is('application/json')) return res.status(415).json({ error: 'JSON بس' });
      const id = String(req.body?.req ?? '');
      const p = pending.get(id);
      if (!p || p.expires < Date.now()) return res.status(404).json({ error: 'الطلب انتهى، ارجع للتطبيق وجرّب الربط مرة ثانية' });
      const account = await accountFromCookie(await accountsReady, req.headers.cookie);
      if (!account) return res.status(401).json({ error: 'سجّل دخول أول' });
      pending.delete(id);
      const back = new URL(p.params.redirectUri);
      if (req.body?.allow === true) {
        const code = token();
        codes.set(code, {
          clientId: p.client.client_id,
          accountId: account.id,
          challenge: p.params.codeChallenge,
          redirectUri: p.params.redirectUri,
          scopes: p.params.scopes?.length ? p.params.scopes : [SCOPE],
          resource: p.params.resource?.href ?? mcpUrl.href,
          expires: Date.now() + CODE_MS,
        });
        back.searchParams.set('code', code);
      } else {
        back.searchParams.set('error', 'access_denied');
      }
      if (p.params.state) back.searchParams.set('state', p.params.state);
      return res.json({ redirect: back.href });
    } catch (err) {
      return next(err);
    }
  });

  const router = mcpAuthRouter({
    provider,
    issuerUrl: new URL(baseUrl),
    resourceServerUrl: mcpUrl,
    scopesSupported: [SCOPE],
    resourceName: 'ألعاب الشلة',
    serviceDocumentationUrl: new URL('/account', baseUrl),
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 }, // 0 = never
  });
  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', baseUrl).href,
  });
  return { router, consent, bearer, provider };
}

module.exports = { createOAuth };
