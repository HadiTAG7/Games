'use strict';

// «برا السالفة»: every phone shows the same secret word, except one player
// (or two) who only sees the category. Everyone asks someone a question,
// then they vote on who is out of the loop, and the outsider gets one guess
// at the word.
//
// Phases: lobby → roles → asking → (free) → vote → guess → roundOver → roles … → final

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { rankedPoints } = require('../night');
const custom = require('../custom');

const MIN_PLAYERS = 3;
const ROUNDS_OPTIONS = [3, 5, 7, 10];
const FREE_SECONDS_OPTIONS = [0, 60, 120];
const TWO_OUTSIDERS_FROM = 7; // players needed before two outsiders are allowed
const GUESS_CHOICES = 8;
const POINTS = { vote: 1, escape: 3, guess: 2 };
const TIMER_GRACE_MS = 400;
const MIN_CUSTOM_WORDS = 4;

class OutsiderGame {
  /** categories: [{ id, name, emoji, words: [word] }] */
  constructor({ categories = [], random = Math.random, now = Date.now, onTimeout = () => {} } = {}) {
    this.bank = categories;
    this.categories = categories;
    this.custom = { name: '', emoji: '', text: '', words: [] }; // «أسئلتكم الخاصة»
    this.customCategory = null;
    this.bankCategories = []; // the host's own banks («بنوكي»)
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = { rounds: 5, outsiders: 1, freeSeconds: 60, categories: categories.map((c) => c.id) };
    this.players = new Map(); // id → { score }
    this.used = new Set(); // "category:word" already played in this room
    this.lastOutsiders = [];
    this.timer = null;
    this.reset();
  }

  reset() {
    this.clearTimer();
    this.phase = 'lobby';
    this.step = 0;
    this.roundNumber = 0;
    this.round = null;
    for (const id of this.players.keys()) this.players.set(id, { score: 0 });
  }

  addPlayer(id) {
    if (!this.players.has(id)) this.players.set(id, { score: 0 });
  }

  /** Someone left: they drop out of the round; if the outsider left, the round is called off. */
  removePlayer(id) {
    this.players.delete(id);
    const { round } = this;
    if (!round || !round.players.includes(id)) return;
    round.players = round.players.filter((p) => p !== id);
    round.pairs = pairsFor(round.players);
    round.askIndex = Math.min(round.askIndex, Math.max(0, round.pairs.length - 1));
    round.votes.delete(id);
    for (const [voter, target] of round.votes) if (target === id) round.votes.delete(voter);
    round.guesses.delete(id);
    if (round.outsiders.includes(id)) {
      round.outsiders = round.outsiders.filter((o) => o !== id);
      if (!round.outsiders.length && this.phase !== 'roundOver') {
        this.clearTimer();
        round.result = { aborted: true, tally: [], caught: [], gains: {} };
        this.phase = 'roundOver';
      }
    }
    this.step += 1;
  }

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    const s = { ...this.settings };
    if (ROUNDS_OPTIONS.includes(Number(patch.rounds))) s.rounds = Number(patch.rounds);
    if (FREE_SECONDS_OPTIONS.includes(Number(patch.freeSeconds))) s.freeSeconds = Number(patch.freeSeconds);
    if ([1, 2].includes(Number(patch.outsiders))) s.outsiders = Number(patch.outsiders);
    if (patch.custom !== undefined) this.setCustom(patch.custom, s);
    if (Array.isArray(patch.categories)) {
      const wanted = new Set(patch.categories);
      s.categories = this.categories.filter((c) => wanted.has(c.id)).map((c) => c.id);
    }
    this.settings = s;
  }

  /** The host's own category: a name and words (one per line, or split by «،»). Picked as soon as it's ready. */
  setCustom(input, s) {
    const words = [...new Set(String(input?.text ?? '').split(/[\n،,]/).map((w) => custom.clean(w, 30)).filter(Boolean))].slice(0, 200);
    const name = custom.clean(input?.name, custom.MAX_NAME) || 'كلماتنا';
    const emoji = custom.clean(input?.emoji, 8) || '✍️';
    this.custom = { name, emoji, text: String(input?.text ?? '').slice(0, 20000), words };
    const ready = words.length >= MIN_CUSTOM_WORDS;
    this.customCategory = ready ? { id: 'custom', name, emoji, words, custom: true } : null;
    for (const key of [...this.used]) if (key.startsWith('custom:')) this.used.delete(key);
    this.rebuildCategories(s);
  }

  /** The host's banks: each ready one becomes a category, picked as it arrives. */
  setBanks(list) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر البنوك أثناء اللعب');
    this.bankCategories = list.filter((c) => c.words.length >= MIN_CUSTOM_WORDS);
    const s = { ...this.settings };
    this.rebuildCategories(s);
    this.settings = s;
  }

  /** Bank + the room's own + banks; new extra categories start picked, gone ones are dropped. */
  rebuildCategories(s) {
    const before = new Set(this.categories.map((c) => c.id));
    this.categories = [...this.bank, ...(this.customCategory ? [this.customCategory] : []), ...this.bankCategories];
    const known = new Set(this.categories.map((c) => c.id));
    const fresh = this.categories.filter((c) => !before.has(c.id)).map((c) => c.id);
    s.categories = [...s.categories.filter((id) => known.has(id)), ...fresh.filter((id) => !s.categories.includes(id))];
  }

  /** How many outsiders this round really gets: two only with enough players. */
  outsiderCount(playerCount = this.players.size) {
    return this.settings.outsiders === 2 && playerCount >= TWO_OUTSIDERS_FROM ? 2 : 1;
  }

  /* ---------- Game flow ---------- */

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (this.players.size < MIN_PLAYERS) throw new GameError(`تحتاجون ${MIN_PLAYERS} لاعبين على الأقل`);
    if (!this.settings.categories.length) throw new GameError('اختر فئة وحدة على الأقل');
    for (const id of this.players.keys()) this.players.set(id, { score: 0 });
    this.roundNumber = 0;
    this.newRound();
  }

  isStale(step) {
    return step !== undefined && step !== this.step;
  }

  /** Picks a word nobody has played here yet; the room starts over once a category runs dry. */
  pickWord() {
    const chosen = this.categories.filter((c) => this.settings.categories.includes(c.id));
    let open = chosen.filter((c) => c.words.some((w) => !this.used.has(`${c.id}:${w}`)));
    if (!open.length) {
      for (const c of chosen) for (const w of c.words) this.used.delete(`${c.id}:${w}`);
      open = chosen;
    }
    const category = open[Math.floor(this.random() * open.length)];
    const fresh = category.words.filter((w) => !this.used.has(`${category.id}:${w}`));
    const word = fresh[Math.floor(this.random() * fresh.length)];
    this.used.add(`${category.id}:${word}`);
    return { category, word };
  }

  newRound() {
    this.clearTimer();
    const players = shuffle([...this.players.keys()], this.random);
    if (players.length < MIN_PLAYERS) throw new GameError(`تحتاجون ${MIN_PLAYERS} لاعبين على الأقل`);
    const { category, word } = this.pickWord();
    // Nobody is the outsider two rounds running, when there are enough people.
    const count = this.outsiderCount(players.length);
    const rested = players.filter((id) => !this.lastOutsiders.includes(id));
    const pool = rested.length >= count ? rested : players;
    const outsiders = shuffle(pool, this.random).slice(0, count);
    this.lastOutsiders = outsiders;
    const others = shuffle(category.words.filter((w) => w !== word), this.random).slice(0, GUESS_CHOICES - 1);
    this.roundNumber += 1;
    this.round = {
      categoryId: category.id,
      word,
      players,
      outsiders,
      pairs: pairsFor(players),
      askIndex: 0,
      endsAt: null,
      votes: new Map(), // voter → target
      guesses: new Map(), // outsider → word
      choices: shuffle([word, ...others], this.random),
      result: null,
    };
    this.phase = 'roles';
    this.step += 1;
  }

  /** Everyone has looked at their card: the questions start. */
  begin(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'roles') throw new GameError('مو وقتها');
    this.phase = 'asking';
    this.step += 1;
  }

  /** The next pair asks; after the last pair comes free questions (if any), then the vote. */
  nextAsker(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'asking') throw new GameError('مو وقت الأسئلة');
    if (this.round.askIndex < this.round.pairs.length - 1) {
      this.round.askIndex += 1;
      this.step += 1;
      return;
    }
    if (this.settings.freeSeconds > 0) {
      this.phase = 'free';
      this.round.endsAt = this.now() + this.settings.freeSeconds * 1000;
      this.scheduleFreeTimeout();
      this.step += 1;
      return;
    }
    this.openVote();
  }

  /** The host can skip straight to the vote at any point of the questions. */
  openVote(step) {
    if (this.isStale(step)) return;
    if (!['roles', 'asking', 'free'].includes(this.phase)) throw new GameError('مو وقت التصويت');
    this.clearTimer();
    this.round.endsAt = null;
    this.phase = 'vote';
    this.step += 1;
  }

  scheduleFreeTimeout() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.phase !== 'free') return;
      this.openVote();
      this.onTimeout();
    }, this.round.endsAt - this.now() + TIMER_GRACE_MS);
    this.timer.unref?.();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  vote(playerId, target) {
    if (this.phase !== 'vote') throw new GameError('التصويت مو مفتوح');
    const { round } = this;
    if (!round.players.includes(playerId)) throw new GameError('أنت مو في هالجولة، انتظر الجولة الجاية');
    if (target === playerId) throw new GameError('ما تقدر تصوّت لنفسك');
    if (!round.players.includes(target)) throw new GameError('اختر لاعب من الجولة');
    round.votes.set(playerId, target);
  }

  /** Has everyone who can still vote voted? (connected: ids of players online) */
  allVoted(connected) {
    const online = new Set(connected);
    return this.round.players.every((id) => this.round.votes.has(id) || !online.has(id));
  }

  /** Votes are in: count them and find out who was caught. The outsiders then get their guess. */
  closeVote(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'vote') throw new GameError('التصويت مو مفتوح');
    const { round } = this;
    const counts = new Map(round.players.map((id) => [id, 0]));
    for (const target of round.votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
    const tally = [...counts].map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes);
    const topInsider = Math.max(0, ...tally.filter((t) => !round.outsiders.includes(t.id)).map((t) => t.votes));
    // An outsider is caught with more votes than anyone who was in on it.
    const caught = round.outsiders.filter((id) => counts.get(id) > 0 && counts.get(id) > topInsider);
    round.result = { tally, caught, gains: {} };
    this.phase = 'guess';
    this.step += 1;
  }

  guess(playerId, word) {
    if (this.phase !== 'guess') throw new GameError('مو وقت التخمين');
    const { round } = this;
    if (!round.outsiders.includes(playerId)) throw new GameError('التخمين لللي برا السالفة بس');
    if (round.guesses.has(playerId)) throw new GameError('خمّنت خلاص');
    if (!round.choices.includes(word)) throw new GameError('اختر من الخيارات');
    round.guesses.set(playerId, word);
    if (round.outsiders.every((id) => round.guesses.has(id))) this.endRound();
  }

  /** The host moves on without waiting for a guess (say, the outsider's phone died). */
  skipGuess(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'guess') throw new GameError('مو وقت التخمين');
    this.endRound();
  }

  endRound() {
    const { round } = this;
    const gains = {};
    const add = (id, n) => { gains[id] = (gains[id] ?? 0) + n; };
    for (const [voter, target] of round.votes) {
      if (!round.outsiders.includes(voter) && round.outsiders.includes(target)) add(voter, POINTS.vote);
    }
    for (const id of round.outsiders) {
      if (!round.result.caught.includes(id)) add(id, POINTS.escape);
      if (round.guesses.get(id) === round.word) add(id, POINTS.guess);
    }
    for (const [id, n] of Object.entries(gains)) {
      const player = this.players.get(id);
      if (player) player.score += n;
    }
    round.result.gains = gains;
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

  dispose() {
    this.clearTimer();
  }
}

/** Everyone asks the next person round the circle, so each asks once and is asked once. */
function pairsFor(players) {
  if (players.length < 2) return [];
  return players.map((asker, i) => ({ asker, target: players[(i + 1) % players.length] }));
}

module.exports = {
  OutsiderGame,
  MIN_PLAYERS,
  ROUNDS_OPTIONS,
  FREE_SECONDS_OPTIONS,
  TWO_OUTSIDERS_FROM,
  GUESS_CHOICES,
  POINTS,
  MIN_CUSTOM_WORDS,
};
