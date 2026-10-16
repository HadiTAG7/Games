'use strict';

// «تحدي الوقت» — two teams name pictures against their own chess clock.
// A correct answer stops your clock and starts the other team's; skipping
// shows a new picture while your clock keeps running. Whoever runs out of
// time loses the round. A wheel picks each round's category, and the first
// team to win the set number of rounds wins the game. The host judges.

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { teamPoints } = require('../night');
const { TEAMS, otherTeam: other, teamSize, joinTeam, moveToTeam, shuffleTeams } = require('./teams');

const SECONDS_OPTIONS = [30, 45, 60, 90];
const ROUNDS_TO_WIN_OPTIONS = [1, 2, 3, 4, 5];
const SKIP_PENALTY_OPTIONS = [0, 3, 5];
const WHEEL_SIZE = 8;
// A fresh deck should have at least this many unseen cards, or the
// category's seen cards are shuffled back in.
const MIN_FRESH_CARDS = 12;

const MAX_EXCLUDED = 5000;

/** Names a card across rebuilds of the card file. */
const cardKey = (categoryId, card) => `${categoryId}:${card.answer}`;

class TimeGame {
  /** categories: [{ id, name, emoji, cards: [{ type, answer, … }] }] */
  constructor({ categories = [], random = Math.random, now = Date.now, onTimeout = () => {} } = {}) {
    this.bank = categories.filter((c) => c.cards.length);
    this.categories = this.bank;
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = {
      seconds: 45,
      roundsToWin: 3,
      skipPenalty: 0,
      categories: this.categories.map((c) => c.id),
    };
    this.teams = new Map(); // playerId → 'red' | 'blue'
    this.phase = 'lobby'; // lobby → wheel → ready → playing → roundOver → … → final
    this.score = { red: 0, blue: 0 };
    this.roundNumber = 0;
    this.round = null;
    this.matchWinner = null;
    this.nextStartTeam = 'red';
    this.usedCategories = new Set();
    this.seenCards = new Map(); // categoryId → Set of card indexes shown this game
    this.excluded = new Set(); // card keys the host took out of the game
    this.timer = null;
    this.turnToken = 0;
  }

  /* ---------- Players and teams ---------- */

  teamSize(team) {
    return teamSize(this.teams, team);
  }

  addPlayer(id) {
    joinTeam(this.teams, id);
  }

  removePlayer(id) {
    this.teams.delete(id);
  }

  setTeam(playerId, team) {
    moveToTeam(this.teams, playerId, team);
  }

  shuffleTeams() {
    shuffleTeams(this.teams, this.random);
  }

  /* ---------- Settings ---------- */

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    const s = { ...this.settings };
    if (SECONDS_OPTIONS.includes(Number(patch.seconds))) s.seconds = Number(patch.seconds);
    if (ROUNDS_TO_WIN_OPTIONS.includes(Number(patch.roundsToWin))) s.roundsToWin = Number(patch.roundsToWin);
    if (SKIP_PENALTY_OPTIONS.includes(Number(patch.skipPenalty))) s.skipPenalty = Number(patch.skipPenalty);
    if (Array.isArray(patch.categories)) {
      const wanted = new Set(patch.categories);
      s.categories = this.categories.filter((c) => wanted.has(c.id)).map((c) => c.id);
    }
    this.settings = s;
  }

  /** The host's banks: each becomes a wheel category, switched on as it arrives. */
  setBanks(list) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر البنوك أثناء اللعب');
    const before = new Set(this.categories.map((c) => c.id));
    this.categories = [...this.bank, ...list.filter((c) => c.cards.length)];
    const known = new Set(this.categories.map((c) => c.id));
    const fresh = this.categories.filter((c) => !before.has(c.id)).map((c) => c.id);
    this.settings = { ...this.settings, categories: [...this.settings.categories.filter((id) => known.has(id)), ...fresh] };
  }

  enabledCategories() {
    const ids = new Set(this.settings.categories);
    return this.categories.filter((c) => ids.has(c.id));
  }

  /* ---------- Game flow ---------- */

  /** excluded: card keys the host's device has taken out before. */
  start({ excluded } = {}) {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (!this.teamSize('red') || !this.teamSize('blue')) throw new GameError('كل فريق يحتاج لاعب واحد على الأقل');
    if (!this.enabledCategories().length) throw new GameError('اختر فئة وحدة على الأقل');
    this.score = { red: 0, blue: 0 };
    this.roundNumber = 0;
    this.round = null;
    this.matchWinner = null;
    this.nextStartTeam = 'red';
    this.usedCategories.clear();
    this.seenCards.clear();
    if (Array.isArray(excluded)) {
      for (const key of excluded.slice(0, MAX_EXCLUDED)) {
        if (typeof key === 'string' && key.length <= 200) this.excluded.add(key);
      }
    }
    this.phase = 'wheel';
  }

  /** Picks the round's category; can spin again until the round starts. */
  spin() {
    if (this.phase !== 'wheel' && this.phase !== 'ready') throw new GameError('مو وقت العجلة');
    const enabled = this.enabledCategories();
    let pool = enabled.filter((c) => !this.usedCategories.has(c.id));
    if (!pool.length) {
      this.usedCategories.clear();
      pool = enabled;
    }
    // Don't land on the same category twice in a row when re-spinning.
    if (this.round && pool.length > 1) pool = pool.filter((c) => c.id !== this.round.category);
    const category = pool[Math.floor(this.random() * pool.length)];
    const others = shuffle(enabled.filter((c) => c.id !== category.id), this.random).slice(0, WHEEL_SIZE - 1);
    const wheel = shuffle([category, ...others], this.random).map((c) => c.id);
    if (this.phase === 'wheel') this.roundNumber += 1;
    const startTeam = this.nextStartTeam;
    const ms = this.settings.seconds * 1000;
    this.round = {
      category: category.id,
      wheel,
      spinId: Math.floor(this.random() * 1e9),
      startTeam,
      deck: this.buildDeck(category),
      position: 0,
      remaining: { red: ms, blue: ms },
      active: startTeam,
      runningSince: null,
      paused: false,
      history: [],
      log: [],
      result: null,
      step: 0, // counts the host's actions, so a repeated tap can be told apart
    };
    this.phase = 'ready';
  }

  buildDeck(category) {
    const seen = this.seenCards.get(category.id) ?? new Set();
    let all = category.cards.map((_, i) => i).filter((i) => !this.excluded.has(cardKey(category.id, category.cards[i])));
    if (!all.length) all = category.cards.map((_, i) => i);
    let fresh = all.filter((i) => !seen.has(i));
    if (fresh.length < Math.min(MIN_FRESH_CARDS, all.length)) fresh = all;
    return shuffle(fresh, this.random).map((index) => {
      const card = { index };
      // Hidden flags show one random patch; everyone sees the same patch.
      if (category.cards[index].type === 'hidden-flag') {
        card.focus = { x: Math.round(this.random() * 100), y: Math.round(this.random() * 100) };
      }
      return card;
    });
  }

  go() {
    if (this.phase !== 'ready') throw new GameError('دوّر العجلة أول');
    this.phase = 'playing';
    this.round.runningSince = this.now();
    this.scheduleTimeout();
  }

  /** Charge the running team for the time since their clock started. */
  settle() {
    const { round } = this;
    if (round.runningSince === null) return;
    const now = this.now();
    round.remaining[round.active] = Math.max(0, round.remaining[round.active] - (now - round.runningSince));
    round.runningSince = now;
  }

  assertRunning() {
    if (this.phase !== 'playing') throw new GameError('الجولة مو شغّالة');
    if (this.round.paused) throw new GameError('الوقت موقّف، كمّل أول');
  }

  /**
   * True when the host acted on a screen that's already out of date — a
   * double tap, or a tap that crossed another update — so it's ignored.
   */
  isStale(step) {
    return this.phase === 'playing' && step !== undefined && step !== this.round.step;
  }

  snapshot() {
    const { round } = this;
    round.history.push({
      remaining: { ...round.remaining },
      active: round.active,
      position: round.position,
      logLength: round.log.length,
    });
  }

  correct(step) {
    if (this.isStale(step)) return;
    this.assertRunning();
    this.settle();
    const { round } = this;
    round.step += 1;
    if (round.remaining[round.active] <= 0) {
      this.endRound(round.active, 'time');
      return;
    }
    this.snapshot();
    round.log.push({ index: round.deck[round.position].index, team: round.active, result: 'correct' });
    round.active = other(round.active);
    this.advance();
  }

  skip(step) {
    if (this.isStale(step)) return;
    this.assertRunning();
    this.settle();
    const { round } = this;
    round.step += 1;
    this.snapshot();
    round.log.push({ index: round.deck[round.position].index, team: round.active, result: 'skip' });
    round.remaining[round.active] = Math.max(0, round.remaining[round.active] - this.settings.skipPenalty * 1000);
    if (round.remaining[round.active] <= 0) {
      this.endRound(round.active, 'time');
      return;
    }
    this.advance();
  }

  /** Takes a bad picture out of the game: a new one, with no time taken. */
  exclude(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'playing') throw new GameError('الجولة مو شغّالة');
    this.settle();
    const { round } = this;
    this.snapshot();
    round.step += 1;
    this.excluded.add(cardKey(round.category, this.category(round.category).cards[round.deck[round.position].index]));
    this.advance();
  }

  advance() {
    const { round } = this;
    round.position += 1;
    if (round.position >= round.deck.length) {
      this.endRound(this.deckLoser(), 'deck');
      return;
    }
    this.scheduleTimeout();
  }

  /** When the pictures run out, the team with less time left loses. */
  deckLoser() {
    const { red, blue } = this.round.remaining;
    if (red === blue) return null;
    return red < blue ? 'red' : 'blue';
  }

  pause(step) {
    if (this.isStale(step)) return;
    this.assertRunning();
    this.settle();
    this.round.step += 1;
    this.round.paused = true;
    this.round.runningSince = null;
    this.clearTimer();
  }

  resume(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'playing' || !this.round.paused) throw new GameError('الوقت مو موقّف');
    this.round.step += 1;
    this.round.paused = false;
    this.round.runningSince = this.now();
    this.scheduleTimeout();
  }

  /** Takes back the host's last «صح» or «تخطي». */
  undo(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'playing') throw new GameError('الجولة مو شغّالة');
    const { round } = this;
    const last = round.history.pop();
    if (!last) throw new GameError('ما فيه شي تتراجع عنه');
    round.step += 1;
    round.remaining = last.remaining;
    round.active = last.active;
    round.position = last.position;
    round.log.length = last.logLength;
    if (!round.paused) {
      round.runningSince = this.now();
      this.scheduleTimeout();
    }
  }

  scheduleTimeout() {
    this.clearTimer();
    const { round } = this;
    if (round.runningSince === null) return;
    const token = ++this.turnToken;
    const delay = round.remaining[round.active] - (this.now() - round.runningSince);
    this.timer = setTimeout(() => {
      if (token !== this.turnToken || this.phase !== 'playing') return;
      this.timer = null;
      this.settle();
      this.endRound(this.round.active, 'time');
      this.onTimeout();
    }, Math.max(0, delay));
    this.timer.unref?.();
  }

  clearTimer() {
    this.turnToken += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** loser: the team that ran out of time, or null for a draw. */
  endRound(loser, reason) {
    const { round } = this;
    this.settle();
    this.clearTimer();
    round.runningSince = null;
    const winner = loser ? other(loser) : null;
    if (winner) this.score[winner] += 1;
    // The picture the losing team was stuck on goes in the recap too.
    const stuck = reason === 'time' && round.position < round.deck.length ? round.deck[round.position].index : null;
    round.result = { winner, loser, reason, stuck };
    this.usedCategories.add(round.category);
    const seen = this.seenCards.get(round.category) ?? new Set();
    for (const entry of round.log) seen.add(entry.index);
    if (stuck !== null) seen.add(stuck);
    this.seenCards.set(round.category, seen);
    this.nextStartTeam = other(round.startTeam);
    if (winner && this.score[winner] >= this.settings.roundsToWin) this.matchWinner = winner;
    this.phase = 'roundOver';
  }

  next() {
    if (this.phase !== 'roundOver') throw new GameError('الجولة ما خلصت');
    if (this.matchWinner) this.phase = 'final';
    else this.phase = 'wheel';
  }

  finish() {
    if (this.phase === 'lobby') throw new GameError('اللعبة ما بدأت');
    if (this.phase === 'playing') {
      this.settle();
      this.clearTimer();
    }
    const { red, blue } = this.score;
    if (!this.matchWinner && red !== blue) this.matchWinner = red > blue ? 'red' : 'blue';
    this.phase = 'final';
  }

  restart() {
    this.clearTimer();
    this.phase = 'lobby';
    this.round = null;
    this.score = { red: 0, blue: 0 };
    this.roundNumber = 0;
    this.matchWinner = null;
  }

  /* ---------- Helpers for views ---------- */

  nightPoints() {
    const { red, blue } = this.score;
    if (!this.matchWinner && red + blue === 0) return {};
    return teamPoints(this.teams, this.matchWinner);
  }

  category(id) {
    return this.categories.find((c) => c.id === id);
  }

  /** The card on screen, with the shared random patch for hidden flags. */
  currentCard() {
    const { round } = this;
    if (this.phase !== 'playing' || !round) return null;
    const entry = round.deck[round.position];
    return { ...this.category(round.category).cards[entry.index], ...(entry.focus ? { focus: entry.focus } : {}) };
  }

  dispose() {
    this.clearTimer();
  }
}

module.exports = {
  TimeGame,
  TEAMS,
  cardKey,
  SECONDS_OPTIONS,
  ROUNDS_TO_WIN_OPTIONS,
  SKIP_PENALTY_OPTIONS,
};
