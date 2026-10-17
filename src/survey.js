'use strict';

// «استبيانكم»: the answers people give to the site's own «عقلية القطيع»
// questions («مع القطيع» rounds) are counted, with no names and no rooms,
// and once a question has enough of them it becomes a «فاميلي فيود»
// question with real points (how many out of 100 said each answer).
//
// Postgres with DATABASE_URL, a local JSON file without it (like community.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeAnswer } = require('./normalize');

const MIN_ROUND_ANSWERS = 3; // a round needs this many answers to count
const MIN_RESPONSES = 30; // a question needs this many answers in all…
const MIN_ROUNDS = 3; // …over this many rounds…
const MIN_COUNT = 2; // …and answers said at least this often…
const MIN_ANSWERS = 4; // …at least this many of them
const MAX_ANSWERS = 8;

const keyOf = (text) => normalizeAnswer(String(text ?? '')).replace(/^ال/, '');

/**
 * One confirmed round as a survey record: the question and how many gave
 * each answer (the host's merges and rejections already applied). null if
 * it doesn't count.
 */
function roundRecord(question, groups) {
  const answers = new Map();
  for (const g of groups) {
    const key = keyOf(g.text);
    if (!key || !g.count) continue;
    const a = answers.get(key) ?? { key, text: g.text, count: 0 };
    a.count += g.count;
    answers.set(key, a);
  }
  const responses = [...answers.values()].reduce((n, a) => n + a.count, 0);
  const questionKey = keyOf(question);
  if (!questionKey || responses < MIN_ROUND_ANSWERS) return null;
  return { questionKey, question: String(question), responses, answers: [...answers.values()] };
}

/** Questions with enough answers, as «فاميلي فيود» questions. entries: [{ questionKey, question, responses, rounds, answers }] */
function toFeudQuestions(entries) {
  const out = [];
  for (const e of entries) {
    if (e.responses < MIN_RESPONSES || e.rounds < MIN_ROUNDS) continue;
    const top = e.answers.filter((a) => a.count >= MIN_COUNT).sort((x, y) => y.count - x.count).slice(0, MAX_ANSWERS);
    if (top.length < MIN_ANSWERS) continue;
    out.push({
      id: `survey-${crypto.createHash('sha1').update(e.questionKey).digest('hex').slice(0, 10)}`,
      q: e.question,
      source: 'survey',
      responses: e.responses,
      answers: top.map((a) => ({ a: a.text, points: Math.max(1, Math.round((a.count / e.responses) * 100)), alt: [] })),
    });
  }
  return out;
}

class FileSurvey {
  constructor(file) {
    this.file = file;
    this.kind = 'file';
    this.persistent = false;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = { questions: {} };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  async record(r) {
    const q = this.data.questions[r.questionKey] ?? { question: r.question, responses: 0, rounds: 0, answers: {} };
    q.responses += r.responses;
    q.rounds += 1;
    for (const a of r.answers) {
      const prev = q.answers[a.key] ?? { text: a.text, count: 0 };
      prev.count += a.count;
      q.answers[a.key] = prev;
    }
    this.data.questions[r.questionKey] = q;
    this.save();
  }

  async all() {
    return Object.entries(this.data.questions).map(([questionKey, q]) => ({
      questionKey,
      question: q.question,
      responses: q.responses,
      rounds: q.rounds,
      answers: Object.entries(q.answers).map(([key, a]) => ({ key, text: a.text, count: a.count })),
    }));
  }
}

class PgSurvey {
  constructor(connectionString, pg = require('pg')) {
    this.kind = 'postgres';
    this.persistent = true;
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS survey_questions (
      question_key TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      responses INTEGER NOT NULL DEFAULT 0,
      rounds INTEGER NOT NULL DEFAULT 0
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS survey_answers (
      question_key TEXT NOT NULL REFERENCES survey_questions(question_key) ON DELETE CASCADE,
      answer_key TEXT NOT NULL,
      answer TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (question_key, answer_key)
    )`);
    return this;
  }

  async record(r) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO survey_questions (question_key, question, responses, rounds) VALUES ($1, $2, $3, 1)
         ON CONFLICT (question_key) DO UPDATE SET responses = survey_questions.responses + $3, rounds = survey_questions.rounds + 1`,
        [r.questionKey, r.question, r.responses],
      );
      for (const a of r.answers) {
        await client.query(
          `INSERT INTO survey_answers (question_key, answer_key, answer, count) VALUES ($1, $2, $3, $4)
           ON CONFLICT (question_key, answer_key) DO UPDATE SET count = survey_answers.count + $4`,
          [r.questionKey, a.key, a.text, a.count],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async all() {
    const { rows: qs } = await this.pool.query('SELECT * FROM survey_questions');
    const { rows: as } = await this.pool.query('SELECT * FROM survey_answers');
    const byQ = new Map(qs.map((q) => [q.question_key, {
      questionKey: q.question_key, question: q.question, responses: q.responses, rounds: q.rounds, answers: [],
    }]));
    for (const a of as) byQ.get(a.question_key)?.answers.push({ key: a.answer_key, text: a.answer, count: a.count });
    return [...byQ.values()];
  }
}

async function openSurvey({ databaseUrl = process.env.DATABASE_URL, file, pg } = {}) {
  if (databaseUrl) return new PgSurvey(databaseUrl, pg).init();
  return new FileSurvey(file);
}

module.exports = {
  openSurvey, FileSurvey, PgSurvey, roundRecord, toFeudQuestions, keyOf,
  MIN_RESPONSES, MIN_ROUNDS, MIN_COUNT, MIN_ANSWERS,
};
