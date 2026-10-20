'use strict';

// Accounts over HTTP, and the whole MCP path the way Claude or ChatGPT use
// it: register, log in on the consent page, get a token, call the tools.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');

const ADMIN = 'كلمة سر المراجعة';

/**
 * The real server on a free port, with its accounts and community bank in a temp folder
 * (or in Postgres: TEST_DATABASE_URL=postgres://… npm test, on an empty database).
 */
async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const port = 4400 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      ACCOUNTS_DIR: path.join(dir, 'accounts'),
      COMMUNITY_FILE: path.join(dir, 'c.json'),
      ADMIN_PASSWORD: ADMIN,
      IMAGE_ALLOW_PRIVATE: '1',
      OAUTH_REFRESH_GRACE_MS: '1500',
      PUBLIC_URL: '',
      RENDER_EXTERNAL_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.on('data', (d) => { if (String(d).includes('localhost')) resolve(); }));
  return `http://localhost:${port}`;
}

/** A browser: keeps the session cookie between requests. */
function browser(base) {
  let cookie = '';
  const call = async (url, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(cookie && { cookie }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
    return { status: res.status, json, res };
  };
  return {
    get: (url) => call(url),
    post: (url, body = {}, headers) => call(url, { method: 'POST', body, headers }),
    get cookie() { return cookie; },
  };
}

async function pictureServer(t) {
  const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#2a7' } }).png().toBuffer();
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/pic.png')) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return; }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('accounts over HTTP: sign up, log in, paste a bank, share it, and the owner\'s accounts tab', async (t) => {
  const base = await startServer(t);
  const fahad = browser(base);
  assert.equal((await fahad.post('/api/account/signup', { username: 'ab', password: '12345678' })).status, 400, 'name too short');
  assert.equal((await fahad.post('/api/account/signup', { username: 'فهد', password: '123' })).status, 400, 'password too short');
  const raw = await fetch(`${base}/api/account/signup`, { method: 'POST', body: 'username=x' });
  assert.equal(raw.status, 415, 'JSON only, so other sites can\'t post forms');

  const signup = await fahad.post('/api/account/signup', { username: 'فهد_99', password: 'كلمة سر فهد' });
  assert.equal(signup.status, 200);
  assert.match(signup.res.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(signup.res.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.equal((await fahad.get('/api/account/me')).json.account.username, 'فهد_99');
  assert.equal((await browser(base).post('/api/account/signup', { username: 'فهد_99', password: '12345678' })).status, 409);

  // A bank from pasted text, then more lines, then one removed.
  const made = await fahad.post('/api/account/banks', { game: 'outsider', name: 'استراحات', emoji: '🏕️', text: 'مخيم، شاليه\nاستراحة\nمزرعة\nمخيم' });
  assert.equal(made.status, 200);
  assert.equal(made.json.added, 4);
  assert.equal(made.json.errors.length, 1, 'the second «مخيم» is a duplicate');
  assert.equal(made.json.bank.playable, true);
  const bankId = made.json.bank.id;
  const more = await fahad.post(`/api/account/banks/${bankId}/items`, { text: 'خيمة' });
  assert.equal(more.json.bank.count, 5);
  const view = await fahad.get(`/api/account/banks/${bankId}`);
  assert.deepEqual(view.json.bank.items.map((i) => i.word), ['مخيم', 'شاليه', 'استراحة', 'مزرعة', 'خيمة']);
  await fahad.post(`/api/account/banks/${bankId}/remove`, { ids: [view.json.bank.items[4].id] });
  assert.equal((await fahad.get('/api/account/banks')).json.banks[0].count, 4);

  // Someone else can't see it.
  const noura = browser(base);
  await noura.post('/api/account/signup', { username: 'noura', password: 'كلمة سر نورة' });
  assert.equal((await noura.get(`/api/account/banks/${bankId}`)).status, 404);
  assert.equal((await noura.post(`/api/account/banks/${bankId}/delete`)).status, 400);
  assert.equal((await browser(base).get('/api/account/banks')).status, 401, 'logged out');

  // «👥 شللي»: the account's groups; only the owner can change one.
  assert.equal((await browser(base).get('/api/account/groups')).status, 401, 'logged out');
  const group = (await fahad.post('/api/account/groups', { name: 'ولاد خالتي' })).json.group;
  const listed = (await fahad.get('/api/account/groups')).json;
  assert.deepEqual(listed.groups.map((g) => [g.name, g.total]), [['ولاد خالتي', 0]]);
  assert.ok(listed.games.some((g) => g.id === 'feud') && !listed.games.some((g) => g.id === 'mafia'), 'games with questions');
  assert.equal((await noura.post(`/api/account/groups/${group.id}/delete`, {})).status, 400);
  // Members: added by username, they see it with the owner's name, can leave, can't change it.
  assert.equal((await fahad.post(`/api/account/groups/${group.id}/members`, { username: 'nobody_here' })).status, 400);
  assert.equal((await fahad.post(`/api/account/groups/${group.id}/members`, { username: 'noura' })).json.member.username, 'noura');
  const hers = (await noura.get('/api/account/groups')).json.groups;
  assert.deepEqual(hers.map((g) => [g.name, g.ownerName, g.mine]), [['ولاد خالتي', 'فهد_99', false]]);
  assert.equal((await noura.post(`/api/account/groups/${group.id}/rename`, { name: 'لا' })).status, 400);
  assert.equal((await noura.post(`/api/account/groups/${group.id}/scores/reset`, {})).status, 400);
  assert.equal((await noura.post(`/api/account/groups/${group.id}/leave`, {})).status, 200);
  assert.deepEqual((await noura.get('/api/account/groups')).json.groups, []);
  assert.equal((await fahad.post(`/api/account/groups/${group.id}/scores/reset`, {})).status, 200);
  assert.equal((await fahad.post(`/api/account/groups/${group.id}/rename`, { name: 'العيال' })).json.group.name, 'العيال');
  assert.equal((await fahad.post(`/api/account/groups/${group.id}/reset`, {})).status, 200);
  assert.equal((await fahad.post(`/api/account/groups/${group.id}/delete`, {})).status, 200);
  assert.deepEqual((await fahad.get('/api/account/groups')).json.groups, []);

  // «📤 أرسله للكل» goes to the review page under the account's name.
  const shared = await fahad.post(`/api/account/banks/${bankId}/share`);
  assert.equal(shared.json.added, 4);
  const admin = { 'x-admin-password': encodeURIComponent(ADMIN) };
  const pending = await (await fetch(`${base}/api/admin/submissions?status=pending`, { headers: admin })).json();
  assert.deepEqual(pending.items.map((i) => i.submitter), Array(4).fill('فهد_99'));
  assert.equal(pending.items[0].payload.newName, 'استراحات');

  // Logging out ends the session; logging in again starts one.
  await fahad.post('/api/account/logout');
  assert.equal((await fahad.get('/api/account/me')).json.account, null);
  assert.equal((await fahad.post('/api/account/login', { username: 'فهد_99', password: 'غلط غلط غلط' })).status, 401);
  assert.equal((await fahad.post('/api/account/login', { username: 'فهد_99', password: 'كلمة سر فهد' })).status, 200);
  assert.equal((await fahad.post('/api/account/password', { current: 'غلط', next: 'جديدة جديدة' })).status, 401);
  assert.equal((await fahad.post('/api/account/password', { current: 'كلمة سر فهد', next: 'جديدة جديدة' })).status, 200);

  // The owner finds the account, sets a new password (logging it out everywhere), and deletes another.
  assert.equal((await fetch(`${base}/api/admin/accounts`)).status, 401);
  const found = await (await fetch(`${base}/api/admin/accounts?q=${encodeURIComponent('فهد')}`, { headers: admin })).json();
  assert.deepEqual(found.accounts.map((a) => a.username), ['فهد_99']);
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post(`/api/admin/accounts/${found.accounts[0].id}/password`, { password: 'من المالك 1' })).status, 200);
  assert.equal((await fahad.get('/api/account/me')).json.account, null, 'logged out after the reset');
  assert.equal((await fahad.post('/api/account/login', { username: 'فهد_99', password: 'من المالك 1' })).status, 200);
  const nouraId = (await (await fetch(`${base}/api/admin/accounts?q=noura`, { headers: admin })).json()).accounts[0].id;
  assert.equal((await post(`/api/admin/accounts/${nouraId}/delete`, {})).status, 200);
  assert.equal((await noura.get('/api/account/me')).json.account, null);
});

test('MCP: an AI app registers, the user allows it, and its tools fill the account\'s banks', async (t) => {
  const base = await startServer(t);
  const pics = await pictureServer(t);
  const user = browser(base);
  await user.post('/api/account/signup', { username: 'reem', password: 'كلمة سر ريم' });

  // The server says where to log in.
  const noToken = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noToken.status, 401);
  assert.match(noToken.headers.get('www-authenticate'), /resource_metadata="[^"]*\/\.well-known\/oauth-protected-resource\/mcp"/);
  const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);

  // An OAuth client like Claude's: stores what it's given, and "opens the browser" at /authorize.
  const saved = {};
  let consentAsked = null;
  const provider = {
    redirectUrl: 'http://127.0.0.1:1/callback',
    clientMetadata: { client_name: 'Test AI', redirect_uris: ['http://127.0.0.1:1/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
    clientInformation: () => saved.client,
    saveClientInformation: (c) => { saved.client = c; },
    tokens: () => saved.tokens,
    saveTokens: (tk) => { saved.tokens = tk; },
    saveCodeVerifier: (v) => { saved.verifier = v; },
    codeVerifier: () => saved.verifier,
    state: () => 'state-123',
    async redirectToAuthorization(url) {
      // The user's browser: /authorize sends it to our consent page…
      const start = await fetch(url, { redirect: 'manual' });
      assert.equal(start.status, 302);
      const consent = new URL(start.headers.get('location'), base);
      assert.equal(consent.pathname, '/oauth/consent');
      const req = consent.searchParams.get('req');
      assert.equal((await browser(base).post('/oauth/decision', { req, allow: true })).status, 401, 'not logged in');
      consentAsked = (await user.get(`/oauth/request?req=${req}`)).json;
      // …where the logged-in user presses «اسمح».
      const { json } = await user.post('/oauth/decision', { req, allow: true });
      const back = new URL(json.redirect);
      assert.equal(back.searchParams.get('state'), 'state-123');
      saved.code = back.searchParams.get('code');
    },
  };

  const mcpUrl = new URL('/mcp', base);
  const client = new Client({ name: 'test-ai', version: '1.0.0' });
  await assert.rejects(client.connect(new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider })), UnauthorizedError);
  assert.deepEqual(consentAsked, { client: { name: 'Test AI', host: '127.0.0.1:1' }, account: { username: 'reem' } });
  const first = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
  await first.finishAuth(saved.code);
  assert.ok(saved.tokens.access_token && saved.tokens.refresh_token);
  assert.equal(saved.client.client_secret_expires_at, 0, 'the app\'s secret never expires');
  await client.connect(new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider }));
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), [
    'add_herd_questions', 'add_letters_questions', 'add_outsider_words', 'add_seen_questions', 'add_time_cards',
    'delete_bank', 'games_guide', 'get_bank', 'list_my_banks', 'remove_from_bank',
  ]);
  const json = (result) => JSON.parse(result.content[0].text);
  assert.match((await client.callTool({ name: 'games_guide', arguments: {} })).content[0].text, /سين جيم/);

  // A سين جيم bank, one question with a picture.
  const questions = [200, 200, 400, 400, 600, 600].map((value, i) => ({ value, q: `سؤال عن الدوري ${i}`, a: `جواب ${i}` }));
  questions[5].image_url = `${pics}/pic.png`;
  const seen = json(await client.callTool({ name: 'add_seen_questions', arguments: { bank_name: 'دوري روشن', emoji: '⚽', questions } }));
  assert.equal(seen.added, 6);
  assert.equal(seen.bank.playable, true);
  const missing = await client.callTool({ name: 'add_seen_questions', arguments: { questions: questions.slice(0, 1) } });
  assert.equal(missing.isError, true, 'needs bank_name or bank_id');

  // A تحدي الوقت bank of picture, emoji and text cards; one broken link is reported, the rest are added.
  const cards = [
    ...Array.from({ length: 13 }, (_, i) => ({ type: 'image', image_url: `${pics}/pic.png?${i}`, answer: `صورة ${i}` })),
    { type: 'image', image_url: `${pics}/gone.png`, answer: 'مكسورة' },
    { type: 'emoji', face: '🦁👑', answer: 'الأسد الملك' },
    { type: 'text', face: 'عاصمة اليابان', answer: 'طوكيو' },
  ];
  const time = json(await client.callTool({ name: 'add_time_cards', arguments: { bank_name: 'صور', cards } }));
  assert.equal(time.added, 15);
  assert.deepEqual(time.errors.map((e) => e.index), [13]);
  assert.equal(time.bank.playable, true);

  const list = json(await client.callTool({ name: 'list_my_banks', arguments: {} }));
  assert.deepEqual(list.banks.map((b) => [b.game, b.name, b.count]), [['seen', 'دوري روشن', 6], ['time', 'صور', 15]]);
  const bank = json(await client.callTool({ name: 'get_bank', arguments: { bank_id: seen.bank.id } }));
  const removed = json(await client.callTool({ name: 'remove_from_bank', arguments: { bank_id: seen.bank.id, item_ids: [bank.items[0].id] } }));
  assert.equal(removed.bank.count, 5);

  // The account page sees the same banks, and the pictures are served.
  const page = await user.get(`/api/account/banks/${time.bank.id}`);
  const img = await fetch(base + page.json.bank.items[0].img);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  assert.equal((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).width, 640);
  assert.deepEqual((await user.get('/api/account/connections')).json.connections.map((c) => c.name), ['Test AI']);

  // Each use of a refresh token hands out a new pair; a retry soon after still works, later it doesn't.
  const refresh = (token) => fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: saved.client.client_id, client_secret: saved.client.client_secret }),
  });
  const old = saved.tokens.refresh_token;
  const fresh = await refresh(old);
  assert.equal(fresh.status, 200);
  const pair = await fresh.json();
  assert.notEqual(pair.refresh_token, old);
  assert.equal((await refresh(old)).status, 200, 'a retried refresh (a lost reply) still works');
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal((await refresh(old)).status, 400, 'after the grace period the old refresh token is spent');

  // «إلغاء الربط» on the account page cuts the app off.
  const call = (token) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal((await call(pair.access_token)).status, 200);
  await user.post(`/api/account/connections/${encodeURIComponent(saved.client.client_id)}/revoke`);
  assert.equal((await call(pair.access_token)).status, 401);
  assert.equal((await refresh(pair.refresh_token)).status, 400);
  assert.deepEqual((await user.get('/api/account/connections')).json.connections, []);
});

test('the consent page: «لا» sends the app away without a code, and each request is answered once', async (t) => {
  const base = await startServer(t);
  const user = browser(base);
  await user.post('/api/account/signup', { username: 'salem', password: 'كلمة سر سالم' });
  const reg = await (await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Other AI', redirect_uris: ['https://example.com/cb'], token_endpoint_auth_method: 'none' }),
  })).json();
  const authorize = (extra = {}) => fetch(`${base}/authorize?${new URLSearchParams({
    response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://example.com/cb', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 's1', ...extra,
  })}`, { redirect: 'manual' });

  const wrong = await authorize({ redirect_uri: 'https://evil.example/cb' });
  assert.equal(wrong.status, 400, 'only the registered redirect');
  const elsewhere = await authorize({ resource: 'https://other.example/mcp' });
  assert.match(elsewhere.headers.get('location'), /error=invalid_target/);

  const req = new URL((await authorize()).headers.get('location'), base).searchParams.get('req');
  const { json } = await user.post('/oauth/decision', { req, allow: false });
  const back = new URL(json.redirect);
  assert.deepEqual([back.searchParams.get('error'), back.searchParams.get('code'), back.searchParams.get('state')], ['access_denied', null, 's1']);
  assert.equal((await user.post('/oauth/decision', { req, allow: true })).status, 404, 'a request is answered once');
  assert.equal((await user.get('/oauth/request?req=nope')).status, 404);
  assert.equal((await fetch(`${base}/oauth/consent?req=${req}`)).status, 200, 'the page itself');
});
