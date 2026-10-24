'use strict';

// «مين النصاب؟»: every phone shows the same secret word, except the impostor's,
// which shows a secret mission instead: something to do out loud during the
// round without anyone noticing («قل كلمة نقانيش ثلاث مرات»). Everyone gives
// a one-word hint in turn (out loud), then they talk it over and vote on their
// phones: who's the impostor, and what was the mission? The impostor then gets
// one guess at the word. At the end, the lowest score spins the punishment wheel.
//
// Phases: lobby → roles → hints → discuss → vote → reveal → guess → roundOver → roles … → final

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { rankedPoints } = require('../night');
const { normalizeAnswer } = require('../normalize');
const { NO_HISTORY, preferNew } = require('../groups');
const DATA = require('../../data/scam.json');

const MIN_PLAYERS = 4;
const ROUNDS_OPTIONS = [3, 5, 7];
const DISCUSS_OPTIONS = [0, 120, 180, 300];
const MISSION_CHOICES = 6;
const GUESS_CHOICES = 6;
const WHEEL_SIZE = 8;
const POINTS = { vote: 1, escaped: 2, caught: -2, done: 2, notDone: 0, exposed: -2, guessed: 1, missed: 0 };
const NOT_NOTICED = 'none'; // «ما لاحظت» at the mission question
const TIMER_GRACE_MS = 400;

/** How a word is remembered for «👥 الشلة». */
const playKey = (word) => normalizeAnswer(word);

class ScamGame {
  /**
   * categories: «برا السالفة»'s [{ id, name, emoji, words }]; missions: [{ id, text }];
   * punishments: [{ id, short, text }] (data/scam.json by default).
   */
  constructor({
    categories = [], random = Math.random, now = Date.now, onTimeout = () => {}, groupHistory = NO_HISTORY,
    missions = DATA.missions, punishments = DATA.punishments,
  } = {}) {
    this.categories = categories;
    this.missions = missions;
    this.punishments = punishments;
    this.groupHistory = groupHistory; // «👥 الشلة»: words the room's group has had on other nights
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = { rounds: 5, discussSeconds: 180, categories: categories.map((c) => c.id) };
    this.players = new Map(); // id → { score }
    this.used = new Set(); // "category:word" already played in this room
    this.usedMissions = new Set();
    this.lastImpostor = null;
    this.timer = null;
    this.reset();
  }

  reset() {
    this.clearTimer();
    this.phase = 'lobby';
    this.step = 0;
    this.roundNumber = 0;
    this.round = null;
    this.punishment = null;
    for (const id of this.players.keys()) this.players.set(id, { score: 0 });
  }

  setGroupHistory(history) {
    this.groupHistory = history ?? NO_HISTORY;
  }

  unitCount() {
    return this.categories.reduce((n, c) => n + c.words.length, 0);
  }

  addPlayer(id) {
    if (!this.players.has(id)) this.players.set(id, { score: 0 });
  }

  /** Someone left: they drop out of the round; if the impostor left, the round is called off. */
  removePlayer(id) {
    this.players.delete(id);
    const { round } = this;
    if (!round || !round.order.includes(id)) return;
    round.order = round.order.filter((p) => p !== id);
    round.hintIndex = Math.min(round.hintIndex, Math.max(0, round.order.length - 1));
    round.votes.delete(id);
    round.picks.delete(id);
    for (const [voter, target] of round.votes) if (target === id) round.votes.delete(voter);
    if (id === round.impostor && this.phase !== 'roundOver') {
      this.clearTimer();
      round.result = { aborted: true };
      this.phase = 'roundOver';
    }
    this.step += 1;
  }

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    const s = { ...this.settings };
    if (ROUNDS_OPTIONS.includes(Number(patch.rounds))) s.rounds = Number(patch.rounds);
    if (DISCUSS_OPTIONS.includes(Number(patch.discussSeconds))) s.discussSeconds = Number(patch.discussSeconds);
    if (Array.isArray(patch.categories)) {
      const wanted = new Set(patch.categories);
      s.categories = this.categories.filter((c) => wanted.has(c.id)).map((c) => c.id);
    }
    this.settings = s;
  }

  /* ---------- Game flow ---------- */

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (this.players.size < MIN_PLAYERS) throw new GameError(`تحتاجون ${MIN_PLAYERS} لاعبين على الأقل`);
    if (!this.settings.categories.length) throw new GameError('اختر فئة وحدة على الأقل');
    for (const id of this.players.keys()) this.players.set(id, { score: 0 });
    this.roundNumber = 0;
    this.punishment = null;
    this.newRound();
  }

  isStale(step) {
    return step !== undefined && step !== this.step;
  }

  /** A word nobody has played here yet (nor the group, when it can); a category that runs dry starts over. */
  pickWord() {
    const chosen = this.categories.filter((c) => this.settings.categories.includes(c.id));
    let open = chosen.filter((c) => c.words.some((w) => !this.used.has(`${c.id}:${w}`)));
    if (!open.length) {
      for (const c of chosen) for (const w of c.words) this.used.delete(`${c.id}:${w}`);
      open = chosen;
    }
    const entries = (list, keep) => list.flatMap((c) => c.words.filter((w) => keep(c, w)).map((w) => ({ c, w })));
    const fresh = preferNew(entries(open, (c, w) => !this.used.has(`${c.id}:${w}`)), 1, this.groupHistory, ({ w }) => playKey(w), entries(chosen, () => true));
    const cats = [...new Set(fresh.map((e) => e.c))];
    const category = cats[Math.floor(this.random() * cats.length)];
    const words = fresh.filter((e) => e.c === category).map((e) => e.w);
    const word = words[Math.floor(this.random() * words.length)];
    this.used.add(`${category.id}:${word}`);
    this.groupHistory.add([playKey(word)]);
    return { category, word };
  }

  /** A mission this room hasn't had tonight (other than `except`). */
  pickMission(except = null) {
    let pool = this.missions.filter((m) => !this.usedMissions.has(m.id) && m.id !== except);
    if (!pool.length) {
      this.usedMissions.clear();
      pool = this.missions.filter((m) => m.id !== except);
    }
    const mission = pool[Math.floor(this.random() * pool.length)];
    this.usedMissions.add(mission.id);
    return mission.id;
  }

  newRound() {
    this.clearTimer();
    const order = shuffle([...this.players.keys()], this.random);
    if (order.length < MIN_PLAYERS) throw new GameError(`تحتاجون ${MIN_PLAYERS} لاعبين على الأقل`);
    const { category, word } = this.pickWord();
    // Nobody is the impostor two rounds running.
    const rested = order.filter((id) => id !== this.lastImpostor);
    const impostor = rested[Math.floor(this.random() * rested.length)];
    this.lastImpostor = impostor;
    const others = shuffle(category.words.filter((w) => w !== word), this.random).slice(0, GUESS_CHOICES - 1);
    this.roundNumber += 1;
    this.round = {
      categoryId: category.id,
      word,
      order, // the hint circle, from the first to speak
      impostor,
      mission: this.pickMission(),
      swapped: false,
      hintIndex: 0,
      endsAt: null,
      votes: new Map(), // voter → suspect
      picks: new Map(), // voter → mission id, or NOT_NOTICED
      missionChoices: null,
      guessChoices: shuffle([word, ...others], this.random),
      guess: null,
      result: null,
    };
    this.phase = 'roles';
    this.step += 1;
  }

  /** The impostor may swap a mission they can't do, once a round, until the vote. */
  swapMission(playerId) {
    const { round } = this;
    if (!round || !['roles', 'hints', 'discuss'].includes(this.phase)) throw new GameError('فات وقت التبديل');
    if (playerId !== round.impostor) throw new GameError('هذا للنصاب بس');
    if (round.swapped) throw new GameError('بدّلت مهمتك خلاص');
    round.mission = this.pickMission(round.mission);
    round.swapped = true;
  }

  /** Everyone has seen their card: the hints go round the circle. */
  begin(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'roles') throw new GameError('مو وقتها');
    this.phase = 'hints';
    this.step += 1;
  }

  /** The next one gives their hint; after the last, the talk starts. */
  nextHinter(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'hints') throw new GameError('مو وقت التلميح');
    if (this.round.hintIndex < this.round.order.length - 1) {
      this.round.hintIndex += 1;
      this.step += 1;
      return;
    }
    this.startDiscussion();
  }

  /** Questions and talk, with a timer if the host set one. */
  startDiscussion(step) {
    if (this.isStale(step)) return;
    if (!['roles', 'hints'].includes(this.phase)) throw new GameError('مو وقت النقاش');
    this.phase = 'discuss';
    const seconds = this.settings.discussSeconds;
    this.round.endsAt = seconds ? this.now() + seconds * 1000 : null;
    if (seconds) this.schedule(this.round.endsAt - this.now() + TIMER_GRACE_MS, () => this.openVote());
    this.step += 1;
  }

  /** The vote: who's the impostor, and which of six was the mission. */
  openVote(step) {
    if (this.isStale(step)) return;
    if (!['roles', 'hints', 'discuss'].includes(this.phase)) throw new GameError('مو وقت التصويت');
    this.clearTimer();
    const { round } = this;
    round.endsAt = null;
    const others = shuffle(this.missions.filter((m) => m.id !== round.mission), this.random).slice(0, MISSION_CHOICES - 1).map((m) => m.id);
    round.missionChoices = shuffle([round.mission, ...others], this.random);
    this.phase = 'vote';
    this.step += 1;
  }

  /** A phone's answers, one or both: { target, mission }. Either can change until the vote closes. */
  vote(playerId, { target, mission } = {}) {
    if (this.phase !== 'vote') throw new GameError('التصويت مو مفتوح');
    const { round } = this;
    if (!round.order.includes(playerId)) throw new GameError('أنت مو في هالجولة، انتظر الجولة الجاية');
    if (target !== undefined) {
      if (target === playerId) throw new GameError('ما تقدر تصوّت لنفسك');
      if (!round.order.includes(target)) throw new GameError('اختر لاعب من الجولة');
      round.votes.set(playerId, target);
    }
    if (mission !== undefined) {
      if (mission !== NOT_NOTICED && !round.missionChoices.includes(mission)) throw new GameError('اختر من الخيارات');
      round.picks.set(playerId, mission);
    }
  }

  /** Has everyone still connected answered both questions? */
  allVoted(connected) {
    const online = new Set(connected);
    const { round } = this;
    return round.order.every((id) => !online.has(id) || (round.votes.has(id) && round.picks.has(id)));
  }

  /**
   * The vote is in. The impostor is caught with more votes than anyone else;
   * the mission is exposed when more than half the others who answered named it.
   */
  closeVote(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'vote') throw new GameError('التصويت مو مفتوح');
    const { round } = this;
    const counts = new Map(round.order.map((id) => [id, 0]));
    for (const target of round.votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
    const tally = [...counts].map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes);
    const mine = counts.get(round.impostor) ?? 0;
    const topOther = Math.max(0, ...tally.filter((t) => t.id !== round.impostor).map((t) => t.votes));
    const answers = [...round.picks].filter(([voter]) => voter !== round.impostor).map(([, pick]) => pick);
    const named = answers.filter((pick) => pick === round.mission).length;
    round.result = {
      tally,
      caught: mine > 0 && mine > topOther,
      exposed: named * 2 > answers.length,
      named,
      answered: answers.length,
      done: null, // the group's call on the mission, when it wasn't exposed
      gains: {},
      lines: [],
    };
    this.phase = 'reveal';
    this.step += 1;
  }

  /** On to the impostor's guess; an unexposed mission needs the group's call first (done: true / false). */
  toGuess(done, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'reveal') throw new GameError('مو وقتها');
    const { result } = this.round;
    if (!result.exposed) {
      if (typeof done !== 'boolean') throw new GameError('قرروا: نفّذ مهمته ولا لا؟');
      result.done = done;
    }
    this.phase = 'guess';
    this.step += 1;
  }

  guess(playerId, word) {
    if (this.phase !== 'guess') throw new GameError('مو وقت التخمين');
    const { round } = this;
    if (playerId !== round.impostor) throw new GameError('التخمين للنصاب بس');
    if (round.guess !== null) throw new GameError('خمّنت خلاص');
    if (!round.guessChoices.includes(word)) throw new GameError('اختر من الخيارات');
    round.guess = word;
    this.endRound();
  }

  /** The host moves on without waiting for the guess. */
  skipGuess(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'guess') throw new GameError('مو وقت التخمين');
    this.endRound();
  }

  /** This round's points: +1 for each right vote; for the impostor, the escape, the mission and the guess. */
  scoreRound() {
    const { round } = this;
    const { result } = round;
    const gains = {};
    const add = (id, n) => { gains[id] = (gains[id] ?? 0) + n; };
    for (const [voter, target] of round.votes) {
      if (voter !== round.impostor && target === round.impostor) add(voter, POINTS.vote);
    }
    const lines = [result.caught ? 'caught' : 'escaped'];
    if (result.exposed) lines.push('exposed');
    else lines.push(result.done ? 'done' : 'notDone');
    lines.push(round.guess === round.word ? 'guessed' : 'missed');
    const scored = lines.map((key) => ({ key, points: POINTS[key] }));
    add(round.impostor, scored.reduce((n, l) => n + l.points, 0));
    return { gains, lines: scored };
  }

  endRound() {
    const { gains, lines } = this.scoreRound();
    for (const [id, n] of Object.entries(gains)) {
      const player = this.players.get(id);
      if (player) player.score += n;
    }
    Object.assign(this.round.result, { gains, lines });
    this.phase = 'roundOver';
    this.step += 1;
  }

  next(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'roundOver') throw new GameError('الجولة ما خلصت');
    if (this.roundNumber >= this.settings.rounds) {
      this.phase = 'final';
      this.step += 1;
      return;
    }
    this.newRound();
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

  /** The punishment wheel for the lowest score (a tie: one of them, by lot). It can spin again. */
  spinPunishment(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'final') throw new GameError('الدولاب في النهاية');
    const rows = this.standings();
    if (rows.length < 2) throw new GameError('تحتاجون لاعبين اثنين على الأقل');
    const lowest = rows.at(-1).score;
    const losers = rows.filter((r) => r.score === lowest).map((r) => r.id);
    const loser = losers[Math.floor(this.random() * losers.length)];
    const pool = this.punishments.filter((p) => p.id !== this.punishment?.id);
    const punishment = pool[Math.floor(this.random() * pool.length)];
    const others = shuffle(this.punishments.filter((p) => p.id !== punishment.id), this.random).slice(0, WHEEL_SIZE - 1);
    this.punishment = {
      loser,
      id: punishment.id,
      wheel: shuffle([punishment, ...others], this.random).map((p) => p.id),
      spinId: Math.floor(this.random() * 1e9),
    };
    this.step += 1;
  }

  /* ---------- Timers ---------- */

  schedule(ms, action) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        action();
      } catch {
        return; // the phase moved on in the meantime
      }
      this.onTimeout();
    }, Math.max(0, ms));
    this.timer.unref?.();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
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
    return this.categories.find((c) => c.id === id);
  }

  mission(id) {
    return this.missions.find((m) => m.id === id);
  }

  punishmentOf(id) {
    return this.punishments.find((p) => p.id === id);
  }

  dispose() {
    this.clearTimer();
  }
}

module.exports = {
  ScamGame,
  MIN_PLAYERS,
  ROUNDS_OPTIONS,
  DISCUSS_OPTIONS,
  MISSION_CHOICES,
  GUESS_CHOICES,
  WHEEL_SIZE,
  POINTS,
  NOT_NOTICED,
};
