'use strict';

// «سين جيم» — two teams and a board of six categories, each with two
// questions worth 200, two worth 400 and two worth 600. Teams take turns
// picking a question; the team on turn answers against its timer, and if it
// misses, the other team gets a shorter turn to steal the points. Each team
// has four helps, once each. The host picks the categories, sees the answer
// and judges. It also plays on one screen with nobody joining («بدون جوالات»):
// the teams just sit in two groups, with names the host types.

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { teamPoints } = require('../night');
const custom = require('../custom');
const { otherTeam, teamSize, joinTeam, moveToTeam, shuffleTeams } = require('./teams');
const { normalizeAnswer } = require('../normalize');
const { NO_HISTORY, preferNew } = require('../groups');

const VALUES = [200, 400, 600];
const PER_VALUE = 2; // questions of each value in a category
const BOARD_SIZE = 6; // categories on the board
const TURN_SECONDS_OPTIONS = [30, 45, 60, 90];
const STEAL_SECONDS_OPTIONS = [15, 20, 30];
const CALL_SECONDS = 30;
const MAX_TEAM_NAME = 20;
// الحفرة: a correct answer also takes the points from the other team.
// دبل: a correct answer is worth double. Both are picked before the question.
// جاوب جوابين and اتصال بصديق are used once the question is up.
const LIFELINES = ['pit', 'double', 'two', 'call'];
const BEFORE_QUESTION = new Set(['pit', 'double']);
const DURING_QUESTION = new Set(['two', 'call']);

const questionKey = (categoryId, value, index) => `${categoryId}:${value}:${index}`;
/** How a question is remembered for «👥 الشلة»: picture questions share their wording, so the picture (or answer) counts too. The host's own aren't remembered. */
const playKey = (categoryId, q) => (categoryId === 'custom' ? null : `${normalizeAnswer(q.q)}|${q.img ?? normalizeAnswer(q.a)}`);

class SeenGame {
  /** categories: [{ id, name, emoji, questions: { 200: [{ q, a, img? }], 400: […], 600: […] } }] */
  constructor({ categories = [], random = Math.random, now = Date.now, groupHistory = NO_HISTORY } = {}) {
    this.bank = categories.filter((c) => VALUES.every((v) => (c.questions[v] ?? []).length >= PER_VALUE));
    this.groupHistory = groupHistory; // «👥 الشلة»: questions the room's group has had on other nights
    this.categories = this.bank;
    this.custom = { name: '', emoji: '', text: '', items: [], bad: 0 }; // «أسئلتكم الخاصة»
    this.customCategory = null;
    this.bankCategories = []; // the host's own banks («بنوكي»)
    this.random = random;
    this.now = now;
    this.settings = {
      turnSeconds: 60,
      stealSeconds: 30,
      categories: this.randomCategories(),
      phones: true, // false: one screen, nobody joins; the host runs it all
      teamNames: { red: '', blue: '' }, // what the host calls the teams ('' = the colour)
    };
    this.teams = new Map(); // playerId → 'red' | 'blue'
    this.seen = new Set(); // questions asked in this room, so new games get new ones
    this.firstTeam = 'red';
    this.reset();
  }

  reset() {
    this.phase = 'lobby'; // lobby → board → picked → question → (steal) → reveal → board … → final
    this.board = []; // [{ category, tiles: [{ id, value, index, wonBy }] }]
    this.score = { red: 0, blue: 0 };
    this.turn = this.firstTeam;
    this.lifelines = { red: new Set(LIFELINES), blue: new Set(LIFELINES) };
    this.current = null;
    this.history = [];
    this.step = 0; // counts the host's actions, so a repeated tap can be told apart
  }

  /* ---------- Players and teams ---------- */

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

  randomCategories() {
    return shuffle(this.categories, this.random).slice(0, BOARD_SIZE).map((c) => c.id);
  }

  setGroupHistory(history) {
    this.groupHistory = history ?? NO_HISTORY;
  }

  unitCount() {
    return this.categories.filter((c) => c.id !== 'custom').reduce((n, c) => n + VALUES.reduce((m, v) => m + c.questions[v].length, 0), 0);
  }

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    const s = { ...this.settings };
    if (TURN_SECONDS_OPTIONS.includes(Number(patch.turnSeconds))) s.turnSeconds = Number(patch.turnSeconds);
    if (STEAL_SECONDS_OPTIONS.includes(Number(patch.stealSeconds))) s.stealSeconds = Number(patch.stealSeconds);
    if (typeof patch.phones === 'boolean') s.phones = patch.phones;
    if (patch.teamNames && typeof patch.teamNames === 'object') {
      s.teamNames = { ...s.teamNames };
      for (const team of ['red', 'blue']) {
        if (patch.teamNames[team] !== undefined) s.teamNames[team] = custom.clean(patch.teamNames[team], MAX_TEAM_NAME);
      }
    }
    if (patch.custom !== undefined) this.setCustom(patch.custom, s);
    if (patch.randomCategories) s.categories = this.randomCategories();
    else if (Array.isArray(patch.categories)) {
      const known = new Set(this.categories.map((c) => c.id));
      s.categories = [...new Set(patch.categories)].filter((id) => known.has(id)).slice(0, BOARD_SIZE);
    }
    this.settings = s;
  }

  /**
   * The host's own category: a name, an emoji, and lines of «القيمة | السؤال | الجواب».
   * It joins the categories once it has two questions of each value.
   */
  setCustom(input, s) {
    const items = [];
    let bad = 0;
    for (const line of custom.lines(input?.text)) {
      const parts = custom.splitLine(line);
      const value = parts && Number(parts[0]);
      if (!parts || parts.length !== 3 || !VALUES.includes(value)) {
        bad += 1;
        continue;
      }
      items.push({ value, q: custom.clean(parts[1], custom.MAX_QUESTION), a: custom.clean(parts[2], custom.MAX_ANSWER) });
    }
    const name = custom.clean(input?.name, custom.MAX_NAME) || 'أسئلتنا';
    const emoji = custom.clean(input?.emoji, 8) || '✍️';
    this.custom = { name, emoji, text: String(input?.text ?? '').slice(0, 20000), items, bad };
    const questions = Object.fromEntries(VALUES.map((v) => [v, items.filter((i) => i.value === v).map(({ q, a }) => ({ q, a }))]));
    const ready = VALUES.every((v) => questions[v].length >= PER_VALUE);
    this.customCategory = ready ? { id: 'custom', name, emoji, questions, custom: true } : null;
    this.rebuildCategories(s);
    for (const key of [...this.seen]) if (key.startsWith('custom:')) this.seen.delete(key);
  }

  /** The host's banks: each ready one becomes a category to pick. */
  setBanks(list) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر البنوك أثناء اللعب');
    this.bankCategories = list.filter((c) => VALUES.every((v) => (c.questions[v] ?? []).length >= PER_VALUE));
    const s = { ...this.settings };
    this.rebuildCategories(s);
    this.settings = s;
  }

  rebuildCategories(s) {
    this.categories = [...this.bank, ...(this.customCategory ? [this.customCategory] : []), ...this.bankCategories];
    const known = new Set(this.categories.map((c) => c.id));
    s.categories = s.categories.filter((id) => known.has(id));
  }

  /* ---------- Game flow ---------- */

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (this.settings.phones && (!teamSize(this.teams, 'red') || !teamSize(this.teams, 'blue'))) {
      throw new GameError('كل فريق يحتاج لاعب واحد على الأقل');
    }
    if (this.settings.categories.length !== BOARD_SIZE) throw new GameError(`اختر ${BOARD_SIZE} فئات`);
    this.reset();
    this.board = this.settings.categories.map((id, c) => {
      const category = this.category(id);
      const tiles = VALUES.flatMap((value) => this.pickQuestions(category, value)
        .map((index, n) => ({ id: `${c}-${value}-${n}`, value, index, wonBy: null })));
      return { category: id, tiles };
    });
    this.phase = 'board';
  }

  /** Questions nobody in this room has had yet, when there are enough of them. */
  pickQuestions(category, value) {
    const all = category.questions[value].map((_, i) => i);
    let fresh = all.filter((i) => !this.seen.has(questionKey(category.id, value, i)));
    if (fresh.length < PER_VALUE) {
      for (const i of all) this.seen.delete(questionKey(category.id, value, i));
      fresh = all;
    }
    fresh = preferNew(fresh, PER_VALUE, this.groupHistory, (i) => playKey(category.id, category.questions[value][i]), all);
    return shuffle(fresh, this.random).slice(0, PER_VALUE);
  }

  /** Ignores a tap made on a screen that's already out of date (a double tap). */
  isStale(step) {
    return step !== undefined && step !== this.step;
  }

  pick(tileId, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'board') throw new GameError('مو وقت اختيار سؤال');
    const tile = this.tile(tileId);
    if (!tile) throw new GameError('السؤال مو موجود');
    if (tile.wonBy) throw new GameError('هذا السؤال انلعب');
    this.current = { tileId, team: this.turn, before: new Set(), during: new Set(), endsAt: null, result: null };
    this.phase = 'picked';
    this.step += 1;
  }

  cancelPick(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'picked') throw new GameError('ما فيه سؤال مختار');
    this.current = null;
    this.phase = 'board';
    this.step += 1;
  }

  /** Before the question: picks or drops الحفرة / دبل. Once it's up: uses جاوب جوابين / اتصال بصديق. */
  lifeline(name, step) {
    if (this.isStale(step)) return;
    const { current } = this;
    if (!LIFELINES.includes(name)) throw new GameError('وسيلة غير معروفة');
    const left = current && this.lifelines[current.team];
    if (this.phase === 'picked' && BEFORE_QUESTION.has(name)) {
      if (current.before.has(name)) current.before.delete(name);
      else if (left.has(name)) current.before.add(name);
      else throw new GameError('الفريق استخدم هذي الوسيلة');
    } else if (this.phase === 'question' && DURING_QUESTION.has(name)) {
      if (!left.has(name)) throw new GameError('الفريق استخدم هذي الوسيلة');
      left.delete(name);
      current.during.add(name);
      if (name === 'call') current.endsAt = this.now() + CALL_SECONDS * 1000;
    } else {
      throw new GameError(BEFORE_QUESTION.has(name) ? 'هذي الوسيلة تنختار قبل ما يطلع السؤال' : 'هذي الوسيلة تنستخدم بعد ما يطلع السؤال');
    }
    this.step += 1;
  }

  showQuestion(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'picked') throw new GameError('اختر سؤال أول');
    const { current } = this;
    for (const name of current.before) this.lifelines[current.team].delete(name);
    const { category, tile } = this.lookup(current.tileId);
    this.seen.add(questionKey(category.id, tile.value, tile.index));
    this.groupHistory.add([playKey(category.id, category.questions[tile.value][tile.index])]);
    current.endsAt = this.now() + this.settings.turnSeconds * 1000;
    this.phase = 'question';
    this.step += 1;
  }

  /** The host's call on the team answering now: the team on turn, or the other team stealing. */
  judge(correct, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'question' && this.phase !== 'steal') throw new GameError('مو وقت الحكم');
    const { current } = this;
    const tile = this.tile(current.tileId);
    const rival = otherTeam(current.team);
    this.history.push(this.snapshot());
    this.step += 1;
    if (this.phase === 'question') {
      if (!correct) {
        this.phase = 'steal';
        current.endsAt = this.now() + this.settings.stealSeconds * 1000;
        return;
      }
      const gain = tile.value * (current.before.has('double') ? 2 : 1);
      this.score[current.team] += gain;
      current.result = { winner: current.team, gain, pit: 0 };
      if (current.before.has('pit')) {
        this.score[rival] -= gain;
        current.result.pit = gain;
      }
      tile.wonBy = current.team;
    } else if (correct) {
      // A steal earns the question's plain value; the helps were the other team's.
      this.score[rival] += tile.value;
      current.result = { winner: rival, gain: tile.value, pit: 0 };
      tile.wonBy = rival;
    } else {
      current.result = { winner: null, gain: 0, pit: 0 };
      tile.wonBy = 'none';
    }
    current.endsAt = null;
    this.phase = 'reveal';
  }

  snapshot() {
    const { current } = this;
    return {
      phase: this.phase,
      score: { ...this.score },
      lifelines: { red: new Set(this.lifelines.red), blue: new Set(this.lifelines.blue) },
      current: { ...current, before: new Set(current.before), during: new Set(current.during) },
      wonBy: this.tile(current.tileId).wonBy,
    };
  }

  /** Takes back the host's last ✅ / ❌ on this question. */
  undo(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'steal' && this.phase !== 'reveal') throw new GameError('ما فيه حكم تتراجع عنه');
    const last = this.history.pop();
    if (!last) throw new GameError('ما فيه حكم تتراجع عنه');
    this.phase = last.phase;
    this.score = last.score;
    this.lifelines = last.lifelines;
    this.current = last.current;
    this.tile(this.current.tileId).wonBy = last.wonBy;
    // The clock starts over for whoever is answering again.
    const seconds = this.phase === 'steal' ? this.settings.stealSeconds : this.settings.turnSeconds;
    this.current.endsAt = this.now() + seconds * 1000;
    this.step += 1;
  }

  next(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'reveal') throw new GameError('السؤال ما خلص');
    this.turn = otherTeam(this.current.team);
    this.current = null;
    this.history = [];
    this.phase = this.tilesLeft() ? 'board' : 'final';
    this.step += 1;
  }

  finish() {
    if (this.phase === 'lobby') throw new GameError('اللعبة ما بدأت');
    this.current = null;
    this.phase = 'final';
    this.step += 1;
  }

  /** Back to the lobby with the same teams; the other team starts next time. */
  restart() {
    this.firstTeam = otherTeam(this.firstTeam);
    this.reset();
  }

  /* ---------- Helpers for views ---------- */

  category(id) {
    return this.categories.find((c) => c.id === id);
  }

  tile(tileId) {
    for (const column of this.board) {
      const tile = column.tiles.find((t) => t.id === tileId);
      if (tile) return tile;
    }
    return null;
  }

  lookup(tileId) {
    const column = this.board.find((col) => col.tiles.some((t) => t.id === tileId));
    const category = this.category(column.category);
    const tile = column.tiles.find((t) => t.id === tileId);
    return { category, tile, question: category.questions[tile.value][tile.index] };
  }

  tilesLeft() {
    return this.board.reduce((n, col) => n + col.tiles.filter((t) => !t.wonBy).length, 0);
  }

  nightPoints() {
    if (!this.board.some((col) => col.tiles.some((t) => t.wonBy))) return {};
    return teamPoints(this.teams, this.winner());
  }

  winner() {
    const { red, blue } = this.score;
    if (red === blue) return null;
    return red > blue ? 'red' : 'blue';
  }

  dispose() {}
}

module.exports = {
  SeenGame,
  VALUES,
  BOARD_SIZE,
  LIFELINES,
  TURN_SECONDS_OPTIONS,
  STEAL_SECONDS_OPTIONS,
  CALL_SECONDS,
};
