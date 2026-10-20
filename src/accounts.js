'use strict';

// Accounts and everything that belongs to one: website sessions, the AI
// apps connected through OAuth (Claude, ChatGPT…), question banks and their
// pictures, and «👥 الشلة» groups with the questions each has played.
//
// With DATABASE_URL set everything lives in Postgres (Neon's free database).
// Without it, a JSON file and a folder of pictures stand in: fine on your
// own computer, but Render wipes them on every deploy.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const { WIN_POINTS } = require('./night');

const scrypt = promisify(crypto.scrypt);
const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');

/* ---------- Passwords and names ---------- */

const USERNAME = /^[\p{L}\p{N}_]{3,20}$/u;
const MIN_PASSWORD = 8;

/** The form a username is compared in: «Fahad» and «fahad» are the same account. */
const usernameKey = (name) => String(name ?? '').normalize('NFKC').trim().toLowerCase();

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(String(password), Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(hash, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

/* ---------- The file store (your computer, tests) ---------- */

class FileAccounts {
  constructor(dir) {
    this.kind = 'file';
    this.persistent = false;
    this.dir = dir;
    this.file = path.join(dir, 'accounts.json');
    this.imageDir = path.join(dir, 'bank-images');
    try {
      this.d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.d = { next: { account: 1, bank: 1 }, accounts: [], sessions: [], clients: [], tokens: [], banks: [], images: [] };
    }
    // Files from before «الشلة» existed.
    this.d.next.group ??= 1;
    this.d.groups ??= [];
    this.d.groupPlays ??= [];
    this.d.groupMembers ??= [];
    this.d.groupScores ??= [];
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.d));
    fs.renameSync(tmp, this.file);
  }

  async createAccount(username, passwordHash) {
    const key = usernameKey(username);
    if (this.d.accounts.some((a) => a.key === key)) return null;
    const account = { id: this.d.next.account++, username, key, passwordHash, createdAt: new Date().toISOString() };
    this.d.accounts.push(account);
    this.save();
    return { id: account.id, username, createdAt: account.createdAt };
  }

  async findAccount(username) {
    return this.d.accounts.find((a) => a.key === usernameKey(username)) ?? null;
  }

  async getAccount(id) {
    const a = this.d.accounts.find((x) => x.id === id);
    return a ? { id: a.id, username: a.username, createdAt: a.createdAt } : null;
  }

  async setPassword(id, passwordHash) {
    const a = this.d.accounts.find((x) => x.id === id);
    if (!a) return false;
    a.passwordHash = passwordHash;
    this.save();
    return true;
  }

  async listAccounts(query = '') {
    const key = usernameKey(query);
    return this.d.accounts.filter((a) => a.key.includes(key)).slice(0, 100).map((a) => ({
      id: a.id, username: a.username, createdAt: a.createdAt, banks: this.d.banks.filter((b) => b.accountId === a.id).length,
    }));
  }

  async deleteAccount(id) {
    const images = this.d.images.filter((i) => i.accountId === id).map((i) => i.id);
    await this.deleteImages(images);
    for (const list of ['sessions', 'tokens', 'banks']) this.d[list] = this.d[list].filter((x) => x.accountId !== id);
    const groups = new Set(this.d.groups.filter((g) => g.accountId === id).map((g) => g.id));
    this.d.groups = this.d.groups.filter((g) => !groups.has(g.id));
    for (const list of ['groupPlays', 'groupMembers', 'groupScores']) this.d[list] = this.d[list].filter((x) => !groups.has(x.groupId));
    this.d.groupMembers = this.d.groupMembers.filter((m) => m.accountId !== id);
    const before = this.d.accounts.length;
    this.d.accounts = this.d.accounts.filter((a) => a.id !== id);
    this.save();
    return this.d.accounts.length < before;
  }

  async addSession(hash, accountId, expiresAt) {
    this.d.sessions.push({ hash, accountId, expiresAt: expiresAt.toISOString() });
    this.save();
  }

  async getSession(hash) {
    const s = this.d.sessions.find((x) => x.hash === hash);
    return s && new Date(s.expiresAt) > new Date() ? { accountId: s.accountId } : null;
  }

  async deleteSessions({ hash, accountId }) {
    this.d.sessions = this.d.sessions.filter((s) => (hash ? s.hash !== hash : s.accountId !== accountId));
    this.save();
  }

  async getClient(id) {
    return this.d.clients.find((c) => c.client_id === id) ?? null;
  }

  async saveClient(client) {
    this.d.clients.push(client);
    this.save();
    return client;
  }

  async addToken(t) {
    this.d.tokens.push({ ...t, expiresAt: t.expiresAt.toISOString(), createdAt: new Date().toISOString() });
    this.save();
  }

  async getToken(hash) {
    const t = this.d.tokens.find((x) => x.hash === hash);
    return t && new Date(t.expiresAt) > new Date() ? { ...t, expiresAt: new Date(t.expiresAt) } : null;
  }

  async setTokenExpiry(hash, expiresAt) {
    const t = this.d.tokens.find((x) => x.hash === hash);
    if (t) t.expiresAt = expiresAt.toISOString();
    this.save();
  }

  async deleteTokens({ hash, accountId, clientId }) {
    this.d.tokens = this.d.tokens.filter((t) => {
      if (hash) return t.hash !== hash;
      return !(t.accountId === accountId && (!clientId || t.clientId === clientId));
    });
    this.save();
  }

  async listConnections(accountId) {
    const now = new Date();
    const live = this.d.tokens.filter((t) => t.accountId === accountId && t.kind === 'refresh' && new Date(t.expiresAt) > now);
    const byClient = new Map();
    for (const t of live) if (!byClient.has(t.clientId) || byClient.get(t.clientId) < t.createdAt) byClient.set(t.clientId, t.createdAt);
    return [...byClient].map(([clientId, since]) => ({ clientId, since, name: this.d.clients.find((c) => c.client_id === clientId)?.client_name ?? clientId }));
  }

  async listBanks(accountId, game = null) {
    return this.d.banks.filter((b) => b.accountId === accountId && (!game || b.game === game)).map((b) => structuredClone(b));
  }

  async getBank(id) {
    const b = this.d.banks.find((x) => x.id === id);
    return b ? structuredClone(b) : null;
  }

  async createBank({ accountId, game, name, emoji }) {
    const now = new Date().toISOString();
    const bank = { id: this.d.next.bank++, accountId, game, name, emoji, items: [], nextItem: 1, createdAt: now, updatedAt: now };
    this.d.banks.push(bank);
    this.save();
    return structuredClone(bank);
  }

  async updateBank(id, { items, nextItem, name, emoji }) {
    const b = this.d.banks.find((x) => x.id === id);
    if (!b) return null;
    if (items) b.items = items;
    if (nextItem) b.nextItem = nextItem;
    if (name) b.name = name;
    if (emoji) b.emoji = emoji;
    b.updatedAt = new Date().toISOString();
    this.save();
    return structuredClone(b);
  }

  async deleteBank(id) {
    const before = this.d.banks.length;
    this.d.banks = this.d.banks.filter((b) => b.id !== id);
    this.save();
    return this.d.banks.length < before;
  }

  async addImage({ id, accountId, data, width, height }) {
    fs.mkdirSync(this.imageDir, { recursive: true });
    fs.writeFileSync(path.join(this.imageDir, `${id}.webp`), data);
    this.d.images.push({ id, accountId, width, height, createdAt: new Date().toISOString() });
    this.save();
  }

  async getImage(id) {
    if (!this.d.images.some((i) => i.id === id)) return null;
    try {
      return fs.readFileSync(path.join(this.imageDir, `${id}.webp`));
    } catch {
      return null;
    }
  }

  async countImages(accountId) {
    return this.d.images.filter((i) => i.accountId === accountId).length;
  }

  async deleteImages(ids) {
    const gone = new Set(ids);
    for (const id of gone) fs.rmSync(path.join(this.imageDir, `${id}.webp`), { force: true });
    this.d.images = this.d.images.filter((i) => !gone.has(i.id));
    this.save();
  }

  withOwner(g) {
    return { ...g, ownerName: this.d.accounts.find((a) => a.id === g.accountId)?.username ?? '' };
  }

  /** Groups the account owns or is a member of. */
  async listGroups(accountId) {
    const member = new Set(this.d.groupMembers.filter((m) => m.accountId === accountId).map((m) => m.groupId));
    return this.d.groups.filter((g) => g.accountId === accountId || member.has(g.id)).map((g) => this.withOwner(g));
  }

  async getGroup(id) {
    const g = this.d.groups.find((x) => x.id === id);
    return g ? this.withOwner(g) : null;
  }

  async createGroup(accountId, name) {
    const group = { id: this.d.next.group++, accountId, name, createdAt: new Date().toISOString(), playedAt: null };
    this.d.groups.push(group);
    this.save();
    return { ...group };
  }

  async renameGroup(id, name) {
    const g = this.d.groups.find((x) => x.id === id);
    if (!g) return null;
    g.name = name;
    this.save();
    return { ...g };
  }

  async deleteGroup(id) {
    const before = this.d.groups.length;
    this.d.groups = this.d.groups.filter((g) => g.id !== id);
    for (const list of ['groupPlays', 'groupMembers', 'groupScores']) this.d[list] = this.d[list].filter((x) => x.groupId !== id);
    this.save();
    return this.d.groups.length < before;
  }

  async groupMembers(groupId) {
    return this.d.groupMembers.filter((m) => m.groupId === groupId)
      .map((m) => ({ accountId: m.accountId, username: this.d.accounts.find((a) => a.id === m.accountId)?.username ?? '', addedAt: m.addedAt }));
  }

  async addGroupMember(groupId, accountId) {
    if (this.d.groupMembers.some((m) => m.groupId === groupId && m.accountId === accountId)) return false;
    this.d.groupMembers.push({ groupId, accountId, addedAt: new Date().toISOString() });
    this.save();
    return true;
  }

  async removeGroupMember(groupId, accountId) {
    const before = this.d.groupMembers.length;
    this.d.groupMembers = this.d.groupMembers.filter((m) => !(m.groupId === groupId && m.accountId === accountId));
    this.save();
    return this.d.groupMembers.length < before;
  }

  /** The group's ranking rows: [{ nameKey, name, points, wins, games, updatedAt }]. */
  async groupScores(groupId) {
    return this.d.groupScores.filter((r) => r.groupId === groupId).map(({ groupId: _, ...r }) => r);
  }

  /** Adds one finished game: rows = [{ nameKey, name, points }] for everyone who played it. */
  async addGroupScores(groupId, rows) {
    const now = new Date().toISOString();
    for (const { nameKey, name, points } of rows) {
      let r = this.d.groupScores.find((x) => x.groupId === groupId && x.nameKey === nameKey);
      if (!r) {
        r = { groupId, nameKey, name, points: 0, wins: 0, games: 0, updatedAt: now };
        this.d.groupScores.push(r);
      }
      r.name = name;
      r.points += points;
      r.wins += points >= WIN_POINTS ? 1 : 0;
      r.games += 1;
      r.updatedAt = now;
    }
    this.save();
  }

  async resetGroupScores(groupId) {
    this.d.groupScores = this.d.groupScores.filter((r) => r.groupId !== groupId);
    this.save();
  }

  async removeGroupScore(groupId, nameKey) {
    const before = this.d.groupScores.length;
    this.d.groupScores = this.d.groupScores.filter((r) => !(r.groupId === groupId && r.nameKey === nameKey));
    this.save();
    return this.d.groupScores.length < before;
  }

  async groupPlays(groupId) {
    const out = {};
    for (const p of this.d.groupPlays) if (p.groupId === groupId) (out[p.game] ??= []).push([p.key, p.playedAt]);
    return out;
  }

  async addGroupPlays(groupId, game, keys) {
    const now = Date.now();
    const have = new Map(this.d.groupPlays.filter((p) => p.groupId === groupId && p.game === game).map((p) => [p.key, p]));
    for (const key of new Set(keys)) {
      if (have.has(key)) have.get(key).playedAt = now;
      else this.d.groupPlays.push({ groupId, game, key, playedAt: now });
    }
    const g = this.d.groups.find((x) => x.id === groupId);
    if (g) g.playedAt = new Date(now).toISOString();
    this.save();
  }

  async removeGroupPlays(groupId, game, keys) {
    const gone = new Set(keys);
    this.d.groupPlays = this.d.groupPlays.filter((p) => !(p.groupId === groupId && p.game === game && gone.has(p.key)));
    this.save();
  }

  async resetGroup(groupId) {
    this.d.groupPlays = this.d.groupPlays.filter((p) => p.groupId !== groupId);
    this.save();
  }

  /** { groupId: { game: count } } for the groups an account owns or is in. */
  async groupCounts(accountId) {
    const mine = new Set((await this.listGroups(accountId)).map((g) => g.id));
    const out = {};
    for (const p of this.d.groupPlays) {
      if (!mine.has(p.groupId)) continue;
      const counts = (out[p.groupId] ??= {});
      counts[p.game] = (counts[p.game] ?? 0) + 1;
    }
    return out;
  }
}

/* ---------- Postgres ---------- */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  resource TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS banks (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  next_item INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bank_images (
  id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS play_groups (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  played_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS group_plays (
  group_id INTEGER NOT NULL REFERENCES play_groups(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  key TEXT NOT NULL,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, game, key)
);
CREATE INDEX IF NOT EXISTS banks_account ON banks(account_id);
CREATE INDEX IF NOT EXISTS tokens_account ON oauth_tokens(account_id);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES play_groups(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, account_id)
);
CREATE TABLE IF NOT EXISTS group_scores (
  group_id INTEGER NOT NULL REFERENCES play_groups(id) ON DELETE CASCADE,
  name_key TEXT NOT NULL,
  name TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, name_key)
);
CREATE INDEX IF NOT EXISTS groups_account ON play_groups(account_id);
CREATE INDEX IF NOT EXISTS group_members_account ON group_members(account_id);
`;

const groupRow = (r) => ({
  id: r.id, accountId: r.account_id, ownerName: r.owner_name ?? '', name: r.name, createdAt: new Date(r.created_at).toISOString(),
  playedAt: r.played_at ? new Date(r.played_at).toISOString() : null,
});
const GROUP_SELECT = 'SELECT g.*, a.username AS owner_name FROM play_groups g JOIN accounts a ON a.id = g.account_id';

const bankRow = (r) => ({
  id: r.id, accountId: r.account_id, game: r.game, name: r.name, emoji: r.emoji, items: r.items, nextItem: r.next_item,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});

class PgAccounts {
  constructor(connectionString, pg = require('pg')) {
    this.kind = 'postgres';
    this.persistent = true;
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  async init() {
    await this.pool.query(SCHEMA);
    return this;
  }

  q(sql, params) {
    return this.pool.query(sql, params);
  }

  async createAccount(username, passwordHash) {
    const { rows } = await this.q(
      'INSERT INTO accounts (username, username_key, password_hash) VALUES ($1, $2, $3) ON CONFLICT (username_key) DO NOTHING RETURNING id, username, created_at',
      [username, usernameKey(username), passwordHash],
    );
    return rows[0] ? { id: rows[0].id, username: rows[0].username, createdAt: new Date(rows[0].created_at).toISOString() } : null;
  }

  async findAccount(username) {
    const { rows } = await this.q('SELECT id, username, password_hash FROM accounts WHERE username_key = $1', [usernameKey(username)]);
    return rows[0] ? { id: rows[0].id, username: rows[0].username, passwordHash: rows[0].password_hash } : null;
  }

  async getAccount(id) {
    const { rows } = await this.q('SELECT id, username, created_at FROM accounts WHERE id = $1', [id]);
    return rows[0] ? { id: rows[0].id, username: rows[0].username, createdAt: new Date(rows[0].created_at).toISOString() } : null;
  }

  async setPassword(id, passwordHash) {
    const { rowCount } = await this.q('UPDATE accounts SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
    return rowCount > 0;
  }

  async listAccounts(query = '') {
    const { rows } = await this.q(
      `SELECT a.id, a.username, a.created_at, COUNT(b.id)::int AS banks FROM accounts a LEFT JOIN banks b ON b.account_id = a.id
       WHERE a.username_key LIKE $1 GROUP BY a.id ORDER BY a.id LIMIT 100`,
      [`%${usernameKey(query).replace(/[%_\\]/g, (c) => `\\${c}`)}%`],
    );
    return rows.map((r) => ({ id: r.id, username: r.username, createdAt: new Date(r.created_at).toISOString(), banks: r.banks }));
  }

  async deleteAccount(id) {
    const { rowCount } = await this.q('DELETE FROM accounts WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async addSession(hash, accountId, expiresAt) {
    await this.q('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)', [hash, accountId, expiresAt]);
  }

  async getSession(hash) {
    const { rows } = await this.q('SELECT account_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [hash]);
    return rows[0] ? { accountId: rows[0].account_id } : null;
  }

  async deleteSessions({ hash, accountId }) {
    if (hash) await this.q('DELETE FROM sessions WHERE token_hash = $1', [hash]);
    else await this.q('DELETE FROM sessions WHERE account_id = $1', [accountId]);
  }

  async getClient(id) {
    const { rows } = await this.q('SELECT data FROM oauth_clients WHERE client_id = $1', [id]);
    return rows[0]?.data ?? null;
  }

  async saveClient(client) {
    await this.q('INSERT INTO oauth_clients (client_id, data) VALUES ($1, $2)', [client.client_id, JSON.stringify(client)]);
    return client;
  }

  async addToken(t) {
    await this.q(
      'INSERT INTO oauth_tokens (token_hash, kind, account_id, client_id, scopes, resource, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [t.hash, t.kind, t.accountId, t.clientId, t.scopes ?? [], t.resource ?? null, t.expiresAt],
    );
  }

  async getToken(hash) {
    const { rows } = await this.q('SELECT * FROM oauth_tokens WHERE token_hash = $1 AND expires_at > now()', [hash]);
    const r = rows[0];
    return r ? { hash: r.token_hash, kind: r.kind, accountId: r.account_id, clientId: r.client_id, scopes: r.scopes, resource: r.resource, expiresAt: new Date(r.expires_at) } : null;
  }

  async setTokenExpiry(hash, expiresAt) {
    await this.q('UPDATE oauth_tokens SET expires_at = $2 WHERE token_hash = $1', [hash, expiresAt]);
  }

  async deleteTokens({ hash, accountId, clientId }) {
    if (hash) await this.q('DELETE FROM oauth_tokens WHERE token_hash = $1', [hash]);
    else if (clientId) await this.q('DELETE FROM oauth_tokens WHERE account_id = $1 AND client_id = $2', [accountId, clientId]);
    else await this.q('DELETE FROM oauth_tokens WHERE account_id = $1', [accountId]);
  }

  async listConnections(accountId) {
    const { rows } = await this.q(
      `SELECT t.client_id, MAX(t.created_at) AS since, c.data->>'client_name' AS name FROM oauth_tokens t
       LEFT JOIN oauth_clients c ON c.client_id = t.client_id
       WHERE t.account_id = $1 AND t.kind = 'refresh' AND t.expires_at > now() GROUP BY t.client_id, c.data`,
      [accountId],
    );
    return rows.map((r) => ({ clientId: r.client_id, since: new Date(r.since).toISOString(), name: r.name ?? r.client_id }));
  }

  async listBanks(accountId, game = null) {
    const { rows } = game
      ? await this.q('SELECT * FROM banks WHERE account_id = $1 AND game = $2 ORDER BY id', [accountId, game])
      : await this.q('SELECT * FROM banks WHERE account_id = $1 ORDER BY id', [accountId]);
    return rows.map(bankRow);
  }

  async getBank(id) {
    const { rows } = await this.q('SELECT * FROM banks WHERE id = $1', [id]);
    return rows[0] ? bankRow(rows[0]) : null;
  }

  async createBank({ accountId, game, name, emoji }) {
    const { rows } = await this.q('INSERT INTO banks (account_id, game, name, emoji) VALUES ($1, $2, $3, $4) RETURNING *', [accountId, game, name, emoji]);
    return bankRow(rows[0]);
  }

  async updateBank(id, { items, nextItem, name, emoji }) {
    const { rows } = await this.q(
      `UPDATE banks SET items = COALESCE($2, items), next_item = COALESCE($3, next_item), name = COALESCE($4, name),
       emoji = COALESCE($5, emoji), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, items ? JSON.stringify(items) : null, nextItem ?? null, name ?? null, emoji ?? null],
    );
    return rows[0] ? bankRow(rows[0]) : null;
  }

  async deleteBank(id) {
    const { rowCount } = await this.q('DELETE FROM banks WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async addImage({ id, accountId, data, width, height }) {
    await this.q('INSERT INTO bank_images (id, account_id, data, width, height) VALUES ($1, $2, $3, $4, $5)', [id, accountId, data, width, height]);
  }

  async getImage(id) {
    const { rows } = await this.q('SELECT data FROM bank_images WHERE id = $1', [id]);
    return rows[0]?.data ?? null;
  }

  async countImages(accountId) {
    const { rows } = await this.q('SELECT COUNT(*)::int AS n FROM bank_images WHERE account_id = $1', [accountId]);
    return rows[0].n;
  }

  async deleteImages(ids) {
    if (ids.length) await this.q('DELETE FROM bank_images WHERE id = ANY($1)', [ids]);
  }

  async listGroups(accountId) {
    const { rows } = await this.q(
      `${GROUP_SELECT} WHERE g.account_id = $1 OR g.id IN (SELECT group_id FROM group_members WHERE account_id = $1) ORDER BY g.id`,
      [accountId],
    );
    return rows.map(groupRow);
  }

  async getGroup(id) {
    const { rows } = await this.q(`${GROUP_SELECT} WHERE g.id = $1`, [id]);
    return rows[0] ? groupRow(rows[0]) : null;
  }

  async createGroup(accountId, name) {
    const { rows } = await this.q('INSERT INTO play_groups (account_id, name) VALUES ($1, $2) RETURNING *', [accountId, name]);
    return groupRow(rows[0]);
  }

  async renameGroup(id, name) {
    const { rows } = await this.q('UPDATE play_groups SET name = $2 WHERE id = $1 RETURNING *', [id, name]);
    return rows[0] ? groupRow(rows[0]) : null;
  }

  async deleteGroup(id) {
    const { rowCount } = await this.q('DELETE FROM play_groups WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async groupPlays(groupId) {
    const { rows } = await this.q('SELECT game, key, played_at FROM group_plays WHERE group_id = $1', [groupId]);
    const out = {};
    for (const r of rows) (out[r.game] ??= []).push([r.key, new Date(r.played_at).getTime()]);
    return out;
  }

  async addGroupPlays(groupId, game, keys) {
    const unique = [...new Set(keys)];
    if (!unique.length) return;
    await this.q(
      `INSERT INTO group_plays (group_id, game, key) SELECT $1, $2, unnest($3::text[])
       ON CONFLICT (group_id, game, key) DO UPDATE SET played_at = now()`,
      [groupId, game, unique],
    );
    await this.q('UPDATE play_groups SET played_at = now() WHERE id = $1', [groupId]);
  }

  async removeGroupPlays(groupId, game, keys) {
    if (keys.length) await this.q('DELETE FROM group_plays WHERE group_id = $1 AND game = $2 AND key = ANY($3)', [groupId, game, keys]);
  }

  async resetGroup(groupId) {
    await this.q('DELETE FROM group_plays WHERE group_id = $1', [groupId]);
  }

  async groupMembers(groupId) {
    const { rows } = await this.q(
      'SELECT m.account_id, a.username, m.added_at FROM group_members m JOIN accounts a ON a.id = m.account_id WHERE m.group_id = $1 ORDER BY m.added_at',
      [groupId],
    );
    return rows.map((r) => ({ accountId: r.account_id, username: r.username, addedAt: new Date(r.added_at).toISOString() }));
  }

  async addGroupMember(groupId, accountId) {
    const { rowCount } = await this.q('INSERT INTO group_members (group_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [groupId, accountId]);
    return rowCount > 0;
  }

  async removeGroupMember(groupId, accountId) {
    const { rowCount } = await this.q('DELETE FROM group_members WHERE group_id = $1 AND account_id = $2', [groupId, accountId]);
    return rowCount > 0;
  }

  async groupScores(groupId) {
    const { rows } = await this.q('SELECT * FROM group_scores WHERE group_id = $1', [groupId]);
    return rows.map((r) => ({ nameKey: r.name_key, name: r.name, points: r.points, wins: r.wins, games: r.games, updatedAt: new Date(r.updated_at).toISOString() }));
  }

  async addGroupScores(groupId, rows) {
    if (!rows.length) return;
    await this.q(
      `INSERT INTO group_scores (group_id, name_key, name, points, wins, games)
       SELECT $1, k, n, p, w, 1 FROM unnest($2::text[], $3::text[], $4::int[], $5::int[]) AS t(k, n, p, w)
       ON CONFLICT (group_id, name_key) DO UPDATE SET name = EXCLUDED.name, points = group_scores.points + EXCLUDED.points,
       wins = group_scores.wins + EXCLUDED.wins, games = group_scores.games + 1, updated_at = now()`,
      [groupId, rows.map((r) => r.nameKey), rows.map((r) => r.name), rows.map((r) => r.points), rows.map((r) => (r.points >= WIN_POINTS ? 1 : 0))],
    );
  }

  async resetGroupScores(groupId) {
    await this.q('DELETE FROM group_scores WHERE group_id = $1', [groupId]);
  }

  async removeGroupScore(groupId, nameKey) {
    const { rowCount } = await this.q('DELETE FROM group_scores WHERE group_id = $1 AND name_key = $2', [groupId, nameKey]);
    return rowCount > 0;
  }

  async groupCounts(accountId) {
    const { rows } = await this.q(
      `SELECT p.group_id, p.game, COUNT(*)::int AS n FROM group_plays p JOIN play_groups g ON g.id = p.group_id
       WHERE g.account_id = $1 OR g.id IN (SELECT group_id FROM group_members WHERE account_id = $1) GROUP BY p.group_id, p.game`,
      [accountId],
    );
    const out = {};
    for (const r of rows) (out[r.group_id] ??= {})[r.game] = r.n;
    return out;
  }
}

async function openAccounts({ databaseUrl = process.env.DATABASE_URL, dir, pg } = {}) {
  if (databaseUrl) return new PgAccounts(databaseUrl, pg).init();
  return new FileAccounts(dir);
}

module.exports = {
  openAccounts, FileAccounts, PgAccounts, hashPassword, checkPassword, usernameKey, sha256, token, USERNAME, MIN_PASSWORD,
};
