'use strict';

// «مين فينا؟»: a question about the people in the room («مين أكثر واحد يتأخر
// على المواعيد؟»). Everyone votes in secret from their phone for one of the
// players (themselves too) and may change their vote until the reveal. The
// reveal shows how many votes each one got, never who voted for whom, and
// everyone who voted for the one with the most votes (any of them, on a tie)
// scores a point. The end gives each question's top name as a «لقب».
//
// Phases: lobby → question → reveal → question … → final

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { rankedPoints } = require('../night');
const { normalizeAnswer } = require('../normalize');
const { NO_HISTORY, preferNew } = require('../groups');

const MIN_PLAYERS = 3;
const ROUNDS_OPTIONS = [5, 8, 10, 15];
const TIMER_OPTIONS = [0, 20, 30];
const SOURCES = ['bank', 'custom', 'mix'];
const MAX_CUSTOM_QUESTIONS = 50;
const MAX_QUESTION_LENGTH = 140;
const POINT = 1;
// A majority needs two votes: when everyone got one, nobody guessed anything.
const MAJORITY_FROM = 2;
// Votes sent right as the clock hits zero still count.
const TIMER_GRACE_MS = 750;

/** How a question is remembered for «👥 الشلة»; the host's own questions aren't. */
const playKey = (q) => (q.custom ? null : normalizeAnswer(q.text));

/** data/who.json's questions ({ id, q, category }) as the game's categories, in the file's order. */
function whoCategories(questions = []) {
  const byName = new Map();
  for (const { q, category } of questions) {
    if (!byName.has(category)) byName.set(category, { id: `w${byName.size + 1}`, name: category, questions: [] });
    byName.get(category).questions.push(q);
  }
  return [...byName.values()];
}

function parseCustomQuestions(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split('\n');
  return [...new Set(lines.map((q) => String(q).trim().replace(/\s+/g, ' ').slice(0, MAX_QUESTION_LENGTH)).filter(Boolean))]
    .slice(0, MAX_CUSTOM_QUESTIONS);
}

class WhoGame {
  /** categories: [{ id, name, questions: [text] }] */
  constructor({ categories = [], random = Math.random, now = Date.now, onTimeout = () => {}, groupHistory = NO_HISTORY } = {}) {
    this.categories = categories;
    this.groupHistory = groupHistory; // «👥 الشلة»: questions the room's group has had on other nights
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = { rounds: 8, timer: 0, source: 'bank', customQuestions: [], categories: categories.map((c) => c.id) };
    this.players = new Map(); // id → { score }
    this.seen = new Set(); // bank questions this room has had
    this.timer = null;
    this.reset();
  }

  reset() {
    this.clearTimer();
    this.phase = 'lobby';
    this.step = 0;
    this.questions = [];
    this.roundIndex = -1;
    this.round = null;
    this.titles = []; // [{ question, top: [id], votes }]: each question's «لقب»
    for (const id of this.players.keys()) this.players.set(id, { score: 0 });
  }

  setGroupHistory(history) {
    this.groupHistory = history ?? NO_HISTORY;
  }

  unitCount() {
    return this.categories.reduce((n, c) => n + c.questions.length, 0);
  }

  addPlayer(id) {
    if (!this.players.has(id)) this.players.set(id, { score: 0 });
  }

  /** Someone left: their vote goes, and so do the votes for them (those players vote again). */
  removePlayer(id) {
    this.players.delete(id);
    const { round } = this;
    if (!round || this.phase !== 'question') return;
    round.votes.delete(id);
    for (const [voter, target] of round.votes) if (target === id) round.votes.delete(voter);
  }

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    const s = { ...this.settings };
    if (ROUNDS_OPTIONS.includes(Number(patch.rounds))) s.rounds = Number(patch.rounds);
    if (TIMER_OPTIONS.includes(Number(patch.timer))) s.timer = Number(patch.timer);
    if (SOURCES.includes(patch.source)) s.source = patch.source;
    if (patch.customQuestions !== undefined) s.customQuestions = parseCustomQuestions(patch.customQuestions);
    if (Array.isArray(patch.categories)) {
      const wanted = new Set(patch.categories);
      s.categories = this.categories.filter((c) => wanted.has(c.id)).map((c) => c.id);
    }
    this.settings = s;
  }

  /** Bank questions from the chosen categories, taking turns between them, none this room (or its group) has had. */
  pickFromBank(count) {
    const chosen = this.categories.filter((c) => this.settings.categories.includes(c.id));
    const all = chosen.flatMap((c) => c.questions.map((text) => ({ text, categoryId: c.id })));
    if (all.filter((q) => !this.seen.has(q.text)).length < count) for (const q of all) this.seen.delete(q.text);
    const open = preferNew(all.filter((q) => !this.seen.has(q.text)), count, this.groupHistory, playKey, all);
    const pools = shuffle(chosen.map((c) => shuffle(open.filter((q) => q.categoryId === c.id), this.random)), this.random);
    const picks = [];
    while (picks.length < count && pools.some((p) => p.length)) {
      for (const pool of pools) if (picks.length < count && pool.length) picks.push(pool.pop());
    }
    for (const q of picks) this.seen.add(q.text);
    return shuffle(picks, this.random);
  }

  /** [{ text, categoryId, custom }]: the night's questions. */
  buildQuestions() {
    const { rounds, source, customQuestions } = this.settings;
    const custom = source === 'bank' ? [] : customQuestions.slice(0, rounds).map((text) => ({ text, categoryId: null, custom: true }));
    if (source === 'custom') {
      if (!custom.length) throw new GameError('اكتب سؤال واحد على الأقل');
      return custom;
    }
    if (!this.settings.categories.length && !custom.length) throw new GameError('اختر فئة وحدة على الأقل');
    const picks = this.pickFromBank(rounds - custom.length);
    return source === 'mix' ? shuffle([...custom, ...picks], this.random) : picks;
  }

  /* ---------- Game flow ---------- */

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (this.players.size < MIN_PLAYERS) throw new GameError(`تحتاجون ${MIN_PLAYERS} لاعبين على الأقل`);
    const questions = this.buildQuestions();
    if (!questions.length) throw new GameError('ما فيه أسئلة');
    this.questions = questions;
    for (const id of this.players.keys()) this.players.set(id, { score: 0 });
    this.titles = [];
    this.roundIndex = -1;
    this.nextQuestion();
  }

  isStale(step) {
    return step !== undefined && step !== this.step;
  }

  nextQuestion() {
    this.roundIndex += 1;
    const question = this.questions[this.roundIndex];
    this.groupHistory.add([playKey(question)]);
    const { timer } = this.settings;
    this.round = {
      question: question.text,
      categoryId: question.categoryId,
      votes: new Map(), // voter → target
      endsAt: timer ? this.now() + timer * 1000 : null,
      result: null,
    };
    this.phase = 'question';
    this.step += 1;
    this.scheduleTimeout();
  }

  scheduleTimeout() {
    this.clearTimer();
    if (!this.round.endsAt) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.phase !== 'question') return;
      this.reveal();
      this.onTimeout();
    }, this.round.endsAt - this.now() + TIMER_GRACE_MS);
    this.timer.unref?.();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  vote(playerId, target) {
    if (this.phase !== 'question') throw new GameError('التصويت انتهى');
    if (!this.players.has(playerId)) throw new GameError('أنت مو داخل اللعبة');
    if (!this.players.has(target)) throw new GameError('اختر واحد من اللاعبين');
    this.round.votes.set(playerId, target);
  }

  /** Has everyone still connected voted? (connected: ids of players online) */
  allVoted(connected) {
    const { votes } = this.round;
    return votes.size > 0 && connected.filter((id) => this.players.has(id)).every((id) => votes.has(id));
  }

  /** Counts the votes; whoever voted for the top name (any of them, on a tie) scores. */
  reveal(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'question') throw new GameError('مو وقت الكشف');
    this.clearTimer();
    const { round } = this;
    const counts = new Map([...this.players.keys()].map((id) => [id, 0]));
    for (const target of round.votes.values()) if (counts.has(target)) counts.set(target, counts.get(target) + 1);
    const tally = [...counts].map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes);
    const most = tally[0]?.votes ?? 0;
    const top = most >= MAJORITY_FROM ? tally.filter((t) => t.votes === most).map((t) => t.id) : [];
    const guessed = [...round.votes].filter(([, target]) => top.includes(target)).map(([voter]) => voter);
    for (const id of guessed) this.players.get(id).score += POINT;
    round.result = { tally, top, most, guessed };
    if (top.length) this.titles.push({ question: round.question, top, votes: most });
    this.phase = 'reveal';
    this.step += 1;
  }

  next(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'reveal') throw new GameError('اكشفوا الأصوات أول');
    if (this.roundIndex + 1 >= this.questions.length) {
      this.phase = 'final';
      this.step += 1;
      return;
    }
    this.nextQuestion();
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
  WhoGame,
  whoCategories,
  MIN_PLAYERS,
  ROUNDS_OPTIONS,
  TIMER_OPTIONS,
  SOURCES,
  MAX_CUSTOM_QUESTIONS,
  POINT,
  MAJORITY_FROM,
};
