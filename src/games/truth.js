'use strict';

// «صح ولا خطأ السريعة»: a statement on the TV, «صح» and «خطأ» on every phone,
// and a few seconds to answer. A phone's first tap is its answer. A right
// answer scores 500, plus up to 500 more the sooner it came (the server times
// it as it arrives); a wrong answer or none scores nothing. The reveal shows
// the answer, one line on why, and how the room split.
//
// Phases: lobby → statement → reveal → statement … → final

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { rankedPoints } = require('../night');
const custom = require('../custom');
const { NO_HISTORY, preferNew } = require('../groups');

const MIN_PLAYERS = 2;
const ROUNDS_OPTIONS = [10, 15, 20];
const SECONDS_OPTIONS = [10, 15];
const SOURCES = ['bank', 'custom', 'mix'];
const MAX_CUSTOM = 50;
const POINTS = { right: 500, speed: 500 };
// Answers that land right as the clock hits zero still count (for the base points).
const TIMER_GRACE_MS = 500;
const YES = new Set(['صح', 'صحيح', 'صح.', 'نعم', 'true', 't', '✓', '✔']);
const NO = new Set(['خطأ', 'خطا', 'خطأ.', 'غلط', 'لا', 'false', 'f', '✗', '✕', '×']);

/** How a statement is remembered for «👥 الشلة»; the host's own aren't. */
const playKey = (st) => (st.custom ? null : st.id);

/** data/truth.json's statements ({ id, s, a, why, category }) as the game's categories, in the file's order. */
function truthCategories(questions = []) {
  const byName = new Map();
  for (const { id, s, a, why, category } of questions) {
    if (!byName.has(category)) byName.set(category, { id: `t${byName.size + 1}`, name: category, statements: [] });
    byName.get(category).statements.push({ id, s, a, why });
  }
  return [...byName.values()];
}

/** «العبارة | صح» or «العبارة | خطأ», one per line. Returns { items: [{ s, a }], bad }. */
function parseCustom(text) {
  const items = [];
  let bad = 0;
  for (const line of custom.lines(text)) {
    const parts = line.split('|').map((p) => p.trim());
    const word = (parts.length >= 2 ? parts.pop() : '').toLowerCase();
    const s = custom.clean(parts.join(' | '), custom.MAX_QUESTION);
    const a = YES.has(word) ? true : NO.has(word) ? false : null;
    if (!s || a === null) bad += 1;
    else if (!items.some((it) => it.s === s)) items.push({ s, a });
  }
  return { items: items.slice(0, MAX_CUSTOM), bad };
}

class TruthGame {
  /** categories: [{ id, name, statements: [{ id, s, a, why }] }] */
  constructor({ categories = [], random = Math.random, now = Date.now, onTimeout = () => {}, groupHistory = NO_HISTORY } = {}) {
    this.categories = categories;
    this.groupHistory = groupHistory; // «👥 الشلة»: statements the room's group has had on other nights
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = { rounds: 15, seconds: 10, source: 'bank', categories: categories.map((c) => c.id) };
    this.custom = { text: '', items: [], bad: 0 }; // «أسئلتكم الخاصة»
    this.players = new Map(); // id → { score }
    this.seen = new Set(); // bank statement ids this room has had
    this.timer = null;
    this.reset();
  }

  reset() {
    this.clearTimer();
    this.phase = 'lobby';
    this.step = 0;
    this.statements = [];
    this.roundIndex = -1;
    this.round = null;
    for (const id of this.players.keys()) this.players.set(id, { score: 0 });
  }

  setGroupHistory(history) {
    this.groupHistory = history ?? NO_HISTORY;
  }

  unitCount() {
    return this.categories.reduce((n, c) => n + c.statements.length, 0);
  }

  addPlayer(id) {
    if (!this.players.has(id)) this.players.set(id, { score: 0 });
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.phase === 'statement') this.round.answers.delete(id);
  }

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    const s = { ...this.settings };
    if (ROUNDS_OPTIONS.includes(Number(patch.rounds))) s.rounds = Number(patch.rounds);
    if (SECONDS_OPTIONS.includes(Number(patch.seconds))) s.seconds = Number(patch.seconds);
    if (SOURCES.includes(patch.source)) s.source = patch.source;
    if (patch.custom !== undefined) {
      const text = String(patch.custom ?? '').slice(0, 20000);
      this.custom = { text, ...parseCustom(text) };
    }
    if (Array.isArray(patch.categories)) {
      const wanted = new Set(patch.categories);
      s.categories = this.categories.filter((c) => wanted.has(c.id)).map((c) => c.id);
    }
    this.settings = s;
  }

  /** Bank statements from the chosen categories, taking turns between them, none this room (or its group) has had. */
  pickFromBank(count) {
    const chosen = this.categories.filter((c) => this.settings.categories.includes(c.id));
    const all = chosen.flatMap((c) => c.statements.map((st) => ({ ...st, categoryId: c.id })));
    if (all.filter((st) => !this.seen.has(st.id)).length < count) for (const st of all) this.seen.delete(st.id);
    const open = preferNew(all.filter((st) => !this.seen.has(st.id)), count, this.groupHistory, playKey, all);
    const pools = shuffle(chosen.map((c) => shuffle(open.filter((st) => st.categoryId === c.id), this.random)), this.random);
    const picks = [];
    while (picks.length < count && pools.some((p) => p.length)) {
      for (const pool of pools) if (picks.length < count && pool.length) picks.push(pool.pop());
    }
    for (const st of picks) this.seen.add(st.id);
    return shuffle(picks, this.random);
  }

  /** [{ id, s, a, why, categoryId, custom }]: the night's statements. */
  buildStatements() {
    const { rounds, source } = this.settings;
    const own = source === 'bank' ? [] : this.custom.items.slice(0, rounds)
      .map((it, i) => ({ id: `c${i}`, s: it.s, a: it.a, why: null, categoryId: null, custom: true }));
    if (source === 'custom') {
      if (!own.length) throw new GameError('اكتب عبارة وحدة على الأقل: «العبارة | صح» أو «العبارة | خطأ»');
      return shuffle(own, this.random);
    }
    if (!this.settings.categories.length && !own.length) throw new GameError('اختر فئة وحدة على الأقل');
    const picks = this.pickFromBank(rounds - own.length);
    return source === 'mix' ? shuffle([...own, ...picks], this.random) : picks;
  }

  /* ---------- Game flow ---------- */

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (this.players.size < MIN_PLAYERS) throw new GameError(`تحتاجون ${MIN_PLAYERS} لاعبين على الأقل`);
    const statements = this.buildStatements();
    if (!statements.length) throw new GameError('ما فيه عبارات');
    this.statements = statements;
    for (const id of this.players.keys()) this.players.set(id, { score: 0 });
    this.roundIndex = -1;
    this.nextStatement();
  }

  isStale(step) {
    return step !== undefined && step !== this.step;
  }

  nextStatement() {
    this.roundIndex += 1;
    const statement = this.statements[this.roundIndex];
    this.groupHistory.add([playKey(statement)]);
    const startedAt = this.now();
    this.round = {
      statement,
      startedAt,
      endsAt: startedAt + this.settings.seconds * 1000,
      answers: new Map(), // player → { answer, at }
      result: null,
    };
    this.phase = 'statement';
    this.step += 1;
    this.scheduleTimeout();
  }

  scheduleTimeout() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.phase !== 'statement') return;
      this.reveal();
      this.onTimeout();
    }, this.round.endsAt - this.now() + TIMER_GRACE_MS);
    this.timer.unref?.();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** A phone's tap: the first one counts, timed as it arrives. */
  answer(playerId, value) {
    if (this.phase !== 'statement') throw new GameError('خلص وقت الجواب');
    if (!this.players.has(playerId)) throw new GameError('أنت مو داخل اللعبة');
    if (typeof value !== 'boolean') throw new GameError('اختر صح أو خطأ');
    const { round } = this;
    if (round.answers.has(playerId)) throw new GameError('جاوبت خلاص');
    const at = this.now();
    if (at > round.endsAt + TIMER_GRACE_MS) throw new GameError('خلص وقت الجواب');
    round.answers.set(playerId, { answer: value, at });
  }

  /** What a right answer at `at` is worth: 500, plus up to 500 for the time left. */
  pointsAt(at) {
    const { startedAt, endsAt } = this.round;
    const left = Math.min(Math.max(endsAt - at, 0), endsAt - startedAt);
    return POINTS.right + Math.round((POINTS.speed * left) / (endsAt - startedAt));
  }

  /** Has everyone still connected answered? (connected: ids of players online) */
  allAnswered(connected) {
    const { answers } = this.round;
    return answers.size > 0 && connected.filter((id) => this.players.has(id)).every((id) => answers.has(id));
  }

  reveal(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'statement') throw new GameError('مو وقت الكشف');
    this.clearTimer();
    const { round } = this;
    const gains = {};
    const counts = { yes: 0, no: 0 };
    for (const [id, { answer, at }] of round.answers) {
      counts[answer ? 'yes' : 'no'] += 1;
      if (answer === round.statement.a && this.players.has(id)) {
        gains[id] = this.pointsAt(at);
        this.players.get(id).score += gains[id];
      }
    }
    round.result = { gains, counts };
    this.phase = 'reveal';
    this.step += 1;
  }

  next(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'reveal') throw new GameError('اكشفوا الجواب أول');
    if (this.roundIndex + 1 >= this.statements.length) {
      this.phase = 'final';
      this.step += 1;
      return;
    }
    this.nextStatement();
  }

  finish() {
    if (this.phase === 'lobby') throw new GameError('اللعبة ما بدأت');
    this.clearTimer();
    this.phase = 'final';
    this.step += 1;
  }

  restart() {
    this.reset();
  }

  /* ---------- Results ---------- */

  /** [{ id, score, rank }] best first; equal scores share a rank. */
  standings() {
    const rows = [...this.players].map(([id, p]) => ({ id, score: p.score }));
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((row, i) => {
      row.rank = i > 0 && rows[i - 1].score === row.score ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }

  nightPoints() {
    return rankedPoints(this.standings());
  }

  category(id) {
    return this.categories.find((c) => c.id === id) ?? null;
  }

  dispose() {
    this.clearTimer();
  }
}

module.exports = {
  TruthGame,
  truthCategories,
  parseCustom,
  MIN_PLAYERS,
  ROUNDS_OPTIONS,
  SECONDS_OPTIONS,
  SOURCES,
  MAX_CUSTOM,
  POINTS,
};
