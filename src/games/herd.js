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
//
// While reviewing, the host can put a doubtful answer to a vote: everyone
// except its authors votes to keep or reject it, and a tie goes back to the
// host.
//
// Bank questions come from the subcategories the host picks; each one has
// its own prompts for each mode, and a game draws evenly across categories
// and then across the subcategories inside each.

const { normalizeAnswer } = require('../normalize');
const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { rankedPoints } = require('../night');
const { NO_HISTORY, preferNew } = require('../groups');

const MIN_BET = 1;
const MAX_BET = 15;
const MAX_ROUNDS = MAX_BET;
const MAX_ANSWER_LENGTH = 40;
const MAX_CUSTOM_QUESTIONS = 50;
const MAX_QUESTION_LENGTH = 140;
const TIMER_OPTIONS = [0, 20, 30, 45, 60, 90];
const SOURCES = ['bank', 'custom', 'mix'];
const MODES = ['same', 'different'];
const VOTE_CHOICES = ['keep', 'reject'];
// Answers sent right as the clock hits zero still count.
const TIMER_GRACE_MS = 750;


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

function setRejected(groups, groupId, rejected) {
  if (!groups.some((g) => g.id === groupId)) throw new GameError('المجموعة غير موجودة');
  return sortGroups(groups.map((g) => (g.id === groupId ? { ...g, rejected } : g)));
}

function toggleRejected(groups, groupId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) throw new GameError('المجموعة غير موجودة');
  return setRejected(groups, groupId, !group.rejected);
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
  /**
   * categories: [{ id, name, emoji, subcategories: [{ id, name, same: [prompt], different: [prompt] }] }]
   */
  /** onSurvey({ question, groups: [{ text, count }] }): a confirmed round for «استبيانكم». */
  constructor({ categories = [], random = Math.random, now = Date.now, onTimeout = () => {}, onSurvey = () => {}, groupHistory = NO_HISTORY } = {}) {
    this.onSurvey = onSurvey;
    this.groupHistory = groupHistory; // «👥 الشلة»: questions the room's group has had on other nights
    this.baseCategories = categories;
    this.categories = categories;
    this.subcategories = categories.flatMap((c) => c.subcategories.map((sub) => ({ ...sub, categoryId: c.id })));
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = {
      mode: 'same',
      rounds: MAX_ROUNDS,
      timer: 0,
      source: 'bank',
      customQuestions: [],
      subcategories: this.subcategories.map((sub) => sub.id),
    };
    this.players = new Map();
    this.phase = 'lobby';
    this.questions = [];
    this.roundIndex = -1;
    this.round = null;
    this.timer = null;
    this.seenQuestions = new Set();
  }

  setGroupHistory(history) {
    this.groupHistory = history ?? NO_HISTORY;
  }

  /** How a question is remembered for «👥 الشلة»: the same prompt in either mode is the same question. */
  playKey(text) {
    return normalizeAnswer(text);
  }

  unitCount() {
    if (this.countedFor !== this.subcategories) {
      this.countedFor = this.subcategories;
      this.units = new Set(this.subcategories.flatMap((sub) => [...sub.same, ...sub.different].map((q) => this.playKey(q)))).size;
    }
    return this.units;
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
    this.round.drafts?.delete(id);
    if (this.phase === 'reveal') {
      this.round.groups = withoutPlayer(this.round.groups, id);
      this.round.history = this.round.history.map((groups) => withoutPlayer(groups, id));
      const { vote } = this.round;
      if (vote) {
        vote.eligible.delete(id);
        vote.votes.delete(id);
        if (!this.round.groups.some((g) => g.id === vote.groupId)) this.round.vote = null;
      }
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
    if (Array.isArray(patch.subcategories)) {
      const wanted = new Set(patch.subcategories);
      s.subcategories = this.subcategories.filter((sub) => wanted.has(sub.id)).map((sub) => sub.id);
    }
    this.settings = s;
  }

  /** The host's banks: each becomes a category with one section, picked as it arrives. */
  setBanks(list) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر البنوك أثناء اللعب');
    const before = new Set(this.subcategories.map((sub) => sub.id));
    this.categories = [...this.baseCategories, ...list];
    this.subcategories = this.categories.flatMap((c) => c.subcategories.map((sub) => ({ ...sub, categoryId: c.id })));
    const known = new Set(this.subcategories.map((sub) => sub.id));
    const fresh = this.subcategories.filter((sub) => !before.has(sub.id)).map((sub) => sub.id);
    this.settings = { ...this.settings, subcategories: [...this.settings.subcategories.filter((id) => known.has(id)), ...fresh] };
  }

  selectedSubcategories() {
    const ids = new Set(this.settings.subcategories);
    return this.subcategories.filter((sub) => ids.has(sub.id));
  }

  /** How many bank questions the current mode and subcategories offer. */
  bankSize() {
    return new Set(this.selectedSubcategories().flatMap((sub) => sub[this.settings.mode])).size;
  }

  /**
   * Draws round-robin across the chosen categories, and inside each category
   * across its chosen subcategories, so a big pick doesn't crowd out the
   * others. Skips questions this room has already seen.
   */
  pickFromBank(count) {
    const { mode } = this.settings;
    const leaves = this.selectedSubcategories().filter((sub) => sub[mode].length);
    const all = leaves.flatMap((sub) => sub[mode]);
    if (all.filter((q) => !this.seenQuestions.has(q)).length < count) {
      for (const q of all) this.seenQuestions.delete(q);
    }
    // New to the room's group too, while the chosen sections have enough of those.
    const open = new Set(preferNew(all.filter((q) => !this.seenQuestions.has(q)), count, this.groupHistory, (q) => this.playKey(q), all));
    const byCategory = new Map();
    for (const sub of leaves) {
      if (!byCategory.has(sub.categoryId)) byCategory.set(sub.categoryId, []);
      byCategory.get(sub.categoryId).push({
        sub,
        questions: shuffle(sub[mode].filter((q) => open.has(q)), this.random),
      });
    }
    const rotations = shuffle([...byCategory.values()], this.random)
      .map((pools) => ({ pools: shuffle(pools, this.random), next: 0 }));
    const picks = [];
    const taken = new Set();
    const hasMore = () => rotations.some((r) => r.pools.some((pool) => pool.questions.length));
    while (picks.length < count && hasMore()) {
      for (const rotation of rotations) {
        if (picks.length >= count) break;
        for (let tries = 0; tries < rotation.pools.length; tries++) {
          const pool = rotation.pools[rotation.next++ % rotation.pools.length];
          let text = pool.questions.pop();
          while (text !== undefined && taken.has(text)) text = pool.questions.pop();
          if (text === undefined) continue;
          taken.add(text);
          picks.push({ text, category: pool.sub.categoryId, subcategory: pool.sub.id });
          break;
        }
      }
    }
    for (const q of picks) this.seenQuestions.add(q.text);
    return shuffle(picks, this.random);
  }

  /** [{ text, category, subcategory }]; host-written questions have neither. */
  buildQuestions() {
    const { rounds, source, customQuestions } = this.settings;
    const custom = source === 'bank'
      ? []
      : customQuestions.slice(0, rounds).map((text) => ({ text, category: null, subcategory: null }));
    if (source === 'custom') {
      if (!custom.length) throw new GameError('اكتب سؤال واحد على الأقل');
      return custom;
    }
    const picks = this.pickFromBank(rounds - custom.length);
    if (!picks.length && !custom.length) {
      throw new GameError(this.settings.subcategories.length ? 'ما فيه أسئلة في الأقسام اللي اخترتها' : 'اختر قسم واحد على الأقل');
    }
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
    const { text, category, subcategory } = this.questions[this.roundIndex];
    if (category) this.groupHistory.add([this.playKey(text)]); // the host's own questions aren't remembered
    this.round = {
      question: text,
      category,
      subcategory,
      answers: new Map(),
      drafts: new Map(), // what each phone has typed but not sent; sent for them when time runs out
      endsAt: timer ? this.now() + timer * 1000 : null,
      groups: [],
      history: [],
      askedIds: new Set(this.players.keys()),
      missed: [],
      vote: null,
      lastVote: null,
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
    this.round.drafts.delete(playerId);
  }

  /** What a phone has typed so far (answer and number), kept quietly until time runs out. */
  saveDraft(playerId, { value, text } = {}) {
    if (this.phase !== 'question' || !this.players.has(playerId)) return;
    const bet = Number(value);
    this.round.drafts.set(playerId, {
      text: typeof text === 'string' ? text.slice(0, 200) : '',
      value: Number.isInteger(bet) ? bet : null,
    });
  }

  /**
   * Time's up: whatever someone typed counts as their answer (it replaces a
   * sent one they were editing), on the number they picked, or their lowest
   * free one if they picked none or a used one.
   */
  takeDrafts() {
    for (const [playerId, draft] of this.round.drafts) {
      const player = this.players.get(playerId);
      const text = draft.text.trim().replace(/\s+/g, ' ').slice(0, MAX_ANSWER_LENGTH);
      if (!player || !text) continue;
      const ok = draft.value >= MIN_BET && draft.value <= MAX_BET && !player.used.has(draft.value);
      const value = ok ? draft.value : lowestUnused(player.used);
      const sent = this.round.answers.get(playerId);
      if (value === null || (sent && sent.text === text && sent.value === value)) continue;
      this.round.answers.set(playerId, { playerId, text, value, auto: true });
    }
    this.round.drafts.clear();
  }

  reveal() {
    if (this.phase !== 'question') throw new GameError('مو وقت الكشف');
    this.clearTimer();
    this.takeDrafts();
    this.round.groups = groupAnswers([...this.round.answers.values()]);
    this.round.history = [];
    this.phase = 'reveal';
  }

  assertNoVote() {
    if (this.round?.vote) throw new GameError('فيه تصويت شغّال، خلّصه أو ألغه أول');
  }

  /** Host edits while reviewing answers; each one can be undone. */
  editGroups(change) {
    if (this.phase !== 'reveal') throw new GameError('التعديل بس وقت مراجعة الأجوبة');
    this.assertNoVote();
    const next = change(this.round.groups);
    this.round.history.push(this.round.groups);
    this.round.groups = next;
    this.round.lastVote = null;
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
    this.assertNoVote();
    this.round.groups = this.round.history.pop();
    this.round.lastVote = null;
  }

  /** eligibleIds: who may vote (the room passes connected players); authors are left out. */
  startVote(groupId, eligibleIds) {
    if (this.phase !== 'reveal') throw new GameError('التصويت بس وقت مراجعة الأجوبة');
    this.assertNoVote();
    const group = this.round.groups.find((g) => g.id === groupId);
    if (!group) throw new GameError('المجموعة غير موجودة');
    const authors = new Set(group.members.map((m) => m.playerId));
    const eligible = new Set([...eligibleIds].filter((id) => this.players.has(id) && !authors.has(id)));
    if (!eligible.size) throw new GameError('ما فيه أحد يقدر يصوّت على هذا الجواب');
    this.round.vote = { groupId, text: group.text, eligible, votes: new Map(), status: 'open' };
    this.round.lastVote = null;
  }

  castVote(playerId, choice) {
    const vote = this.round?.vote;
    if (this.phase !== 'reveal' || !vote || vote.status !== 'open') throw new GameError('ما فيه تصويت الحين');
    if (!vote.eligible.has(playerId)) throw new GameError('ما تقدر تصوّت على هذا الجواب');
    if (!VOTE_CHOICES.includes(choice)) throw new GameError('اختر يُقبل أو ينرفض');
    vote.votes.set(playerId, choice);
  }

  voteTally() {
    const votes = [...(this.round?.vote?.votes.values() ?? [])];
    return { keep: votes.filter((v) => v === 'keep').length, reject: votes.filter((v) => v === 'reject').length };
  }

  /** Closes the vote and applies the majority; a tie waits for the host. */
  finishVote() {
    const vote = this.round?.vote;
    if (!vote || vote.status !== 'open') throw new GameError('ما فيه تصويت شغّال');
    const { keep, reject } = this.voteTally();
    if (keep === reject) vote.status = 'tie';
    else this.applyVote(reject > keep, 'players');
  }

  decideTie(reject) {
    if (this.round?.vote?.status !== 'tie') throw new GameError('ما فيه تعادل تقرر فيه');
    this.applyVote(Boolean(reject), 'host');
  }

  applyVote(rejected, decidedBy) {
    const { vote } = this.round;
    const tally = this.voteTally();
    this.round.vote = null;
    this.editGroups((groups) => setRejected(groups, vote.groupId, rejected));
    this.round.lastVote = { text: vote.text, ...tally, rejected, decidedBy };
  }

  cancelVote() {
    if (!this.round?.vote) throw new GameError('ما فيه تصويت شغّال');
    this.round.vote = null;
  }

  winners() {
    return winningGroupIds(this.round ? this.round.groups : [], this.settings.mode);
  }

  confirm() {
    if (this.phase !== 'reveal') throw new GameError('مو وقت اعتماد النتيجة');
    this.assertNoVote();
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
        auto: Boolean(answer.auto),
        won,
        value: answer.value,
        gained,
        text: answer.text,
        groupSize: group.members.length,
        rejected: group.rejected,
      };
    }
    this.phase = 'results';
    this.surveyRound();
  }

  /**
   * «استبيانكم»: a «مع القطيع» round on one of the site's own questions goes
   * to the survey as answer counts, with no names (not the host's own
   * questions or banks, and rejected answers left out).
   */
  surveyRound() {
    const { round } = this;
    if (this.settings.mode !== 'same' || !round.category || String(round.subcategory).startsWith('bank-')) return;
    const groups = round.groups.filter((g) => !g.rejected).map((g) => ({ text: g.text, count: g.members.length }));
    this.onSurvey({ question: round.question, groups });
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

  nightPoints() {
    return rankedPoints(this.standings());
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
  setRejected,
  parseCustomQuestions,
  VOTE_CHOICES,
  MODES,
  MIN_BET,
  MAX_BET,
  MAX_ROUNDS,
  MAX_ANSWER_LENGTH,
  TIMER_OPTIONS,
};
