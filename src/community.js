'use strict';

// Questions people send to the site («أضف أسئلة»). They wait for the
// owner's approval, then join the question banks for every room.
//
// With DATABASE_URL set (a Postgres database such as Neon's free one) they
// live in the database. Without it they go to a local JSON file: fine on
// your own computer, but Render wipes files on every deploy.

const fs = require('fs');
const path = require('path');

const STATUSES = ['pending', 'approved', 'rejected'];

/** One stored submission, the same shape from either store. */
function row(r) {
  return {
    id: Number(r.id),
    game: r.game,
    payload: r.payload,
    status: r.status,
    submitter: r.submitter ?? null,
    createdAt: new Date(r.created_at ?? r.createdAt).toISOString(),
    decidedAt: r.decided_at || r.decidedAt ? new Date(r.decided_at ?? r.decidedAt).toISOString() : null,
  };
}

class FileStore {
  constructor(file) {
    this.file = file;
    this.kind = 'file';
    this.persistent = false;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = { nextId: 1, items: [] };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  async list(status) {
    return this.data.items.filter((i) => !status || i.status === status).map(row);
  }

  async add(entries) {
    const now = new Date().toISOString();
    const added = entries.map((e) => ({ id: this.data.nextId++, ...e, status: 'pending', createdAt: now, decidedAt: null }));
    this.data.items.push(...added);
    this.save();
    return added.map(row);
  }

  async decide(id, status, payload) {
    const item = this.data.items.find((i) => i.id === id);
    if (!item) return null;
    item.status = status;
    if (payload) item.payload = payload;
    item.decidedAt = new Date().toISOString();
    this.save();
    return row(item);
  }

  async remove(id) {
    const before = this.data.items.length;
    this.data.items = this.data.items.filter((i) => i.id !== id);
    this.save();
    return this.data.items.length < before;
  }
}

class PgStore {
  /** pg: the node-postgres module (injectable for tests). */
  constructor(connectionString, pg = require('pg')) {
    this.kind = 'postgres';
    this.persistent = true;
    this.pool = new pg.Pool({ connectionString, max: 3 });
  }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      game TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submitter TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ
    )`);
    return this;
  }

  async list(status) {
    const { rows } = status
      ? await this.pool.query('SELECT * FROM submissions WHERE status = $1 ORDER BY id', [status])
      : await this.pool.query('SELECT * FROM submissions ORDER BY id');
    return rows.map(row);
  }

  async add(entries) {
    const added = [];
    for (const e of entries) {
      const { rows } = await this.pool.query(
        'INSERT INTO submissions (game, payload, submitter) VALUES ($1, $2, $3) RETURNING *',
        [e.game, JSON.stringify(e.payload), e.submitter ?? null],
      );
      added.push(row(rows[0]));
    }
    return added;
  }

  async decide(id, status, payload) {
    const { rows } = payload
      ? await this.pool.query('UPDATE submissions SET status = $2, payload = $3, decided_at = now() WHERE id = $1 RETURNING *',
        [id, status, JSON.stringify(payload)])
      : await this.pool.query('UPDATE submissions SET status = $2, decided_at = now() WHERE id = $1 RETURNING *', [id, status]);
    return rows[0] ? row(rows[0]) : null;
  }

  async remove(id) {
    const { rowCount } = await this.pool.query('DELETE FROM submissions WHERE id = $1', [id]);
    return rowCount > 0;
  }
}

async function openStore({ databaseUrl = process.env.DATABASE_URL, file, pg } = {}) {
  if (databaseUrl) return new PgStore(databaseUrl, pg).init();
  return new FileStore(file);
}

module.exports = { openStore, FileStore, PgStore, STATUSES };
