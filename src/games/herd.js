'use strict';

// «عقلية القطيع» (Herd Mentality) — everyone answers the same prompt.
// Before answering, each player bets one of their numbers 1..15; every number
// can be bet once per game, and skipping a question burns your lowest unused
// number. Winners gain their bet; everyone else gets nothing.
//
// Two modes decide who wins:
//   same       «مع القطيع»: the biggest group of matching answers (ties all
//              win, a group needs 2+ people).
//   different  «عكس القطيع»: every answer nobody else gave.
// In both, the host can reject invalid answers so they can't win.

const { normalizeAnswer } = require('../normalize');

const MIN_BET = 1;
const MAX_BET = 15;
const MAX_ROUNDS = MAX_BET;
const MAX_ANSWER_LENGTH = 40;
const MAX_CUSTOM_QUESTIONS = 50;
const MAX_QUESTION_LENGTH = 140;
const TIMER_OPTIONS = [0, 20, 30, 45, 60, 90];
const SOURCES = ['bank', 'custom', 'mix'];
const MODES = ['same', 'different'];
// Answers sent right as the clock hits zero still count.
const TIMER_GRACE_MS = 750;

class GameError extends Error {}

function shuffle(items, random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseCustomQuestions(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split('\n');
  return lines
    .map((q) => String(q).trim().replace(/\s+/g, ' ').slice(0, MAX_QUESTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_CUSTOM_QUESTIONS);
}

/** The spelling most players used, so the group reads naturally. */
function displayText(members) {
  const counts = new Map();
  let best = members[0].text;
  for (const m of members) {
    const c = (counts.get(m.text) || 0) + 1;
    counts.set(m.text, c);
    if (c > counts.get(best)) best = m.text;
  }
  return best;
}

function sortGroups(groups) {
  return [...groups].sort(
    (a, b) => Number(a.rejected) - Number(b.rejected)
      || b.members.length - a.members.length
      || a.text.localeCompare(b.text, 'ar'),
  );
}

/** answers: [{ playerId, text, value }] → groups: [{ id, text, members }] */
function groupAnswers(answers) {
  const byKey = new Map();
  for (const a of answers) {
    const key = normalizeAnswer(a.text);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(a);
  }
  let n = 0;
  return sortGroups(
    [...byKey.values()].map((members) => ({ id: `g${++n}`, text: displayText(members), members, rejected: false })),
  );
}

function mergeGroups(groups, fromId, toId) {
  if (fromId === toId) throw new GameError('اختر مجموعتين مختلفتين');
  const from = groups.find((g) => g.id === fromId);
  const to = groups.find((g) => g.id === toId);
  if (!from || !to) throw new GameError('المجموعة غير موجودة');
  const members = [...to.members, ...from.members];
  const merged = { id: to.id, text: displayText(members), members, rejected: to.rejected };
  return sortGroups(groups.filter((g) => g !== from && g !== to).concat(merged));
}

function withoutPlayer(groups, playerId) {
  return sortGroups(
    groups
      .map((g) => ({ ...g, members: g.members.filter((m) => m.playerId !== playerId) }))
      .filter((g) => g.members.length)
      .map((g) => ({ ...g, text: displayText(g.members) })),
  );
}

function toggleRejected(groups, groupId) {
  if (!groups.some((g) => g.id === groupId)) throw new GameError('المجموعة غير موجودة');
  return sortGroups(groups.map((g) => (g.id === groupId ? { ...g, rejected: !g.rejected } : g)));
}

/**
 * same: the biggest valid group wins, ties all win, a lone answer never wins.
 * different: every valid answer given by exactly one player wins, as long as
 * at least two players answered.
 */
function winningGroupIds(groups, mode = 'same') {
  const valid = groups.filter((g) => !g.rejected);
  if (mode === 'different') {
    const answered = groups.reduce((n, g) => n + g.members.length, 0);
    if (answered < 2) return new Set();
    return new Set(valid.filter((g) => g.members.length === 1).map((g) => g.id));
  }
  const top = Math.max(0, ...valid.map((g) => g.members.length));
  if (top < 2) return new Set();
  return new Set(valid.filter((g) => g.members.length === top).map((g) => g.id));
}

function lowestUnused(used) {
  for (let n = MIN_BET; n <= MAX_BET; n++) if (!used.has(n)) return n;
  return null;
}

function freshPlayerState() {
  return { score: 0, used: new Set(), last: null };
}

class HerdGame {
  constructor({ questionBanks = {}, random = Math.random, now = Date.now, onTimeout = () => {} } = {}) {
    this.questionBanks = { same: [], different: [], ...questionBanks };
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = { mode: 'same', rounds: MAX_ROUNDS, timer: 0, source: 'bank', customQuestions: [] };
    this.players = new Map();
    this.phase = 'lobby';
    this.questions = [];
    this.roundIndex = -1;
    this.round = null;
    this.timer = null;
    this.seenQuestions = new Set();
  }

  addPlayer(id) {
    if (!this.players.has(id)) this.players.set(id, freshPlayerState());
    // Joining while a question is open still counts as being asked it.
    if (this.phase === 'question') this.round.askedIds.add(id);
  }

  removePlayer(id) {
    this.players.delete(id);
    if (!this.round) return;
    this.round.answers.delete(id);
    if (this.phase === 'reveal') {
      this.round.groups = withoutPlayer(this.round.groups, id);
      this.round.history = this.round.history.map((groups) => withoutPlayer(groups, id));
    }
  }

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) {
      throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    }
    const s = { ...this.settings };
    if (patch.rounds !== undefined) s.rounds = clampInt(patch.rounds, 1, MAX_ROUNDS, s.rounds);
    if (patch.timer !== undefined && TIMER_OPTIONS.includes(Number(patch.timer))) {
      s.timer = Number(patch.timer);
    }
    if (patch.source !== undefined && SOURCES.includes(patch.source)) s.source = patch.source;
    if (patch.customQuestions !== undefined) {
      s.customQuestions = parseCustomQuestions(patch.customQuestions);
    }
    if (patch.mode !== undefined && MODES.includes(patch.mode)) s.mode = patch.mode;
    this.settings = s;
  }

  get questionBank() {
    return this.questionBanks[this.settings.mode];
  }

  pickFromBank(count) {
    const bank = this.questionBank;
    let pool = bank.filter((q) => !this.seenQuestions.has(q));
    if (pool.length < count) {
      for (const q of bank) this.seenQuestions.delete(q);
      pool = [...bank];
    }
    const picks = shuffle(pool, this.random).slice(0, count);
    for (const q of picks) this.seenQuestions.add(q);
    return picks;
  }

  buildQuestions() {
    const { rounds, source, customQuestions } = this.settings;
    const custom = source === 'bank' ? [] : customQuestions.slice(0, rounds);
    if (source === 'custom') {
      if (!custom.length) throw new GameError('اكتب سؤال واحد على الأقل');
      return custom;
    }
    const picks = this.pickFromBank(rounds - custom.length);
    return source === 'mix' ? shuffle([...custom, ...picks], this.random) : picks;
  }

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (this.players.size < 2) throw new GameError('تحتاجون لاعبين اثنين على الأقل');
    const questions = this.buildQuestions();
    if (!questions.length) throw new GameError('ما فيه أسئلة');
    this.questions = questions;
    for (const id of this.players.keys()) this.players.set(id, freshPlayerState());
    this.roundIndex = -1;
    this.startNextRound();
  }

  startNextRound() {
    this.roundIndex += 1;
    const { timer } = this.settings;
    this.round = {
      question: this.questions[this.roundIndex],
      answers: new Map(),
      endsAt: timer ? this.now() + timer * 1000 : null,
      groups: [],
      history: [],
      askedIds: new Set(this.players.keys()),
      missed: [],
    };
    for (const p of this.players.values()) p.last = null;
    this.phase = 'question';
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

  submitAnswer(playerId, { value, text } = {}) {
    if (this.phase !== 'question') throw new GameError('وقت الإجابة انتهى');
    const player = this.players.get(playerId);
    if (!player) throw new GameError('أنت مو داخل اللعبة');
    const bet = Number(value);
    if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) {
      throw new GameError(`اختر رقم من ${MIN_BET} إلى ${MAX_BET}`);
    }
    if (player.used.has(bet)) throw new GameError('هذا الرقم استخدمته قبل، اختر غيره');
    const clean = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
    if (!clean) throw new GameError('اكتب جوابك');
    if (clean.length > MAX_ANSWER_LENGTH) throw new GameError('الجواب طويل، اختصره');
    this.round.answers.set(playerId, { playerId, text: clean, value: bet });
  }

  reveal() {
    if (this.phase !== 'question') throw new GameError('مو وقت الكشف');
    this.clearTimer();
    this.round.groups = groupAnswers([...this.round.answers.values()]);
    this.round.history = [];
    this.phase = 'reveal';
  }

  /** Host edits while reviewing answers; each one can be undone. */
  editGroups(change) {
    if (this.phase !== 'reveal') throw new GameError('التعديل بس وقت مراجعة الأجوبة');
    const next = change(this.round.groups);
    this.round.history.push(this.round.groups);
    this.round.groups = next;
  }

  merge(fromId, toId) {
    this.editGroups((groups) => mergeGroups(groups, fromId, toId));
  }

  toggleReject(groupId) {
    this.editGroups((groups) => toggleRejected(groups, groupId));
  }

  undo() {
    if (this.phase !== 'reveal' || !this.round.history.length) {
      throw new GameError('ما فيه شي تتراجع عنه');
    }
    this.round.groups = this.round.history.pop();
  }

  winners() {
    return winningGroupIds(this.round ? this.round.groups : [], this.settings.mode);
  }

  confirm() {
    if (this.phase !== 'reveal') throw new GameError('مو وقت اعتماد النتيجة');
    const winners = this.winners();
    const groupOf = new Map();
    for (const g of this.round.groups) for (const m of g.members) groupOf.set(m.playerId, g);
    for (const [id, player] of this.players) {
      const answer = this.round.answers.get(id);
      if (!answer) {
        // Only players who saw the question lose a number for skipping it.
        const burned = this.round.askedIds.has(id) ? lowestUnused(player.used) : null;
        if (burned !== null) {
          player.used.add(burned);
          this.round.missed.push({ playerId: id, value: burned });
        }
        player.last = { answered: false, won: false, value: burned, gained: 0 };
        continue;
      }
      const group = groupOf.get(id);
      const won = Boolean(group && winners.has(group.id));
      const gained = won ? answer.value : 0;
      player.used.add(answer.value);
      player.score += gained;
      player.last = {
        answered: true,
        won,
        value: answer.value,
        gained,
        text: answer.text,
        groupSize: group.members.length,
        rejected: group.rejected,
      };
    }
    this.phase = 'results';
  }

  isLastRound() {
    return this.roundIndex + 1 >= this.questions.length;
  }

  next() {
    if (this.phase !== 'results') throw new GameError('اعتمد النتيجة أول');
    if (this.isLastRound()) this.finish();
    else this.startNextRound();
  }

  finish() {
    if (this.phase === 'lobby') throw new GameError('اللعبة ما بدأت');
    this.clearTimer();
    this.phase = 'final';
  }

  restart() {
    this.clearTimer();
    this.phase = 'lobby';
    this.questions = [];
    this.roundIndex = -1;
    this.round = null;
    for (const id of this.players.keys()) this.players.set(id, freshPlayerState());
  }

  /** [{ id, score, rank }] best first; equal scores share a rank. */
  standings() {
    const rows = [...this.players].map(([id, p]) => ({ id, score: p.score }));
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((row, i) => {
      row.rank = i > 0 && rows[i - 1].score === row.score ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }

  gameWinners() {
    return this.standings().filter((row) => row.rank === 1).map((row) => row.id);
  }

  dispose() {
    this.clearTimer();
  }
}

module.exports = {
  HerdGame,
  GameError,
  groupAnswers,
  mergeGroups,
  winningGroupIds,
  toggleRejected,
  parseCustomQuestions,
  MODES,
  MIN_BET,
  MAX_BET,
  MAX_ROUNDS,
  MAX_ANSWER_LENGTH,
  TIMER_OPTIONS,
};
