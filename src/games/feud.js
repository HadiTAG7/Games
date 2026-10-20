'use strict';

// «فاميلي فيود» — two teams guess the most popular answers to a survey
// question. Each round opens with a face-off: one player from each team
// races to the buzzer, and the better answer wins control. The team in
// control names answers until the board is clear or it has three strikes;
// then the other team gets one guess to steal the round's points. The last
// round counts double. Optionally the winners then play «المال السريع»: two
// of them answer five quick questions on their phones, and 200 points or
// more wins it. The host judges, and it also plays with nobody on a phone.
//
// Phases: lobby → faceoff → choose → play (→ steal) → roundOver → faceoff …
//         → (fastSetup → fast → fastReview → fast → fastReview) → final

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { teamPoints } = require('../night');
const custom = require('../custom');
const { normalizeAnswer } = require('../normalize');
const { NO_HISTORY, preferNew } = require('../groups');
const { TEAMS, otherTeam: other, teamSize, joinTeam, moveToTeam, shuffleTeams } = require('./teams');

const ROUNDS_OPTIONS = [3, 4, 5];
const STRIKES = 3;
const MIN_ANSWERS = 4; // a question needs this many answers on its board
const FAST_QUESTIONS = 5;
const FAST_MIN_ANSWERS = 5;
const FAST_SECONDS = [20, 25]; // the first and second player
const FAST_TARGET = 200;
const MAX_ANSWER = 40;
const MAX_TEAM_NAME = 20;
const TIMER_GRACE_MS = 750;

/** How an answer is compared: normalized, without a leading «ال». */
const key = (text) => normalizeAnswer(text).replace(/^ال/, '');

/** The board slot a typed answer matches (its text or one of its alternatives), or null. */
function matchAnswer(text, answers) {
  const typed = key(text ?? '');
  if (!typed) return null;
  for (let i = 0; i < answers.length; i++) {
    const forms = [answers[i].a, ...(answers[i].alt ?? [])].map(key).filter(Boolean);
    if (forms.includes(typed)) return i;
  }
  // «كبسة دجاج» for «كبسة»: one contains the other, when both are long enough to mean something.
  for (let i = 0; i < answers.length; i++) {
    const forms = [answers[i].a, ...(answers[i].alt ?? [])].map(key).filter((f) => f.length >= 3);
    if (typed.length >= 3 && forms.some((f) => typed.includes(f) || f.includes(typed))) return i;
  }
  return null;
}

class FeudGame {
  /** questions: [{ id, q, answers: [{ a, points, alt? }], source?: 'bank' | 'survey', responses? }] */
  constructor({ categories = [], random = Math.random, now = Date.now, onTimeout = () => {}, groupHistory = NO_HISTORY } = {}) {
    this.bank = categories.filter((q) => (q.answers ?? []).length >= MIN_ANSWERS);
    this.groupHistory = groupHistory; // «👥 الشلة»: questions the room's group has had on other nights
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = {
      rounds: 4,
      fastMoney: true,
      phones: true, // false: one screen, nobody joins; the host runs it all
      teamNames: { red: '', blue: '' },
    };
    this.teams = new Map(); // playerId → 'red' | 'blue'
    this.queue = { red: [], blue: [] }; // each team's players in the order they face off
    this.seen = new Set(); // question ids asked in this room
    this.timer = null;
    this.reset();
  }

  reset() {
    this.clearTimer();
    this.phase = 'lobby';
    this.step = 0;
    this.score = { red: 0, blue: 0 };
    this.roundNumber = 0;
    this.round = null;
    this.fast = null;
    this.matchWinner = null;
    this.history = [];
  }

  /* ---------- Players and teams ---------- */

  addPlayer(id) {
    joinTeam(this.teams, id);
    this.fixFaceoff();
  }

  removePlayer(id) {
    this.teams.delete(id);
    this.fixFaceoff();
  }

  setTeam(playerId, team) {
    moveToTeam(this.teams, playerId, team);
    this.fixFaceoff();
  }

  shuffleTeams() {
    shuffleTeams(this.teams, this.random);
    this.fixFaceoff();
  }

  members(team) {
    return [...this.teams].filter(([, t]) => t === team).map(([id]) => id);
  }

  /** Whose turn it is to face off for a team (they go to the end of the line once they have). */
  nextPlayer(team) {
    const members = this.members(team);
    const kept = this.queue[team].filter((id) => members.includes(id));
    this.queue[team] = [...kept, ...shuffle(members.filter((id) => !kept.includes(id)), this.random)];
    return this.queue[team][0] ?? null;
  }

  /** Before anyone buzzes, a face-off player who left or changed teams is replaced. */
  fixFaceoff() {
    const f = this.round?.faceoff;
    if (this.phase !== 'faceoff' || !f || f.buzz) return;
    for (const team of TEAMS) if (this.teams.get(f.players[team]) !== team) f.players[team] = this.nextPlayer(team);
  }

  /* ---------- Settings ---------- */

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    const s = { ...this.settings };
    if (ROUNDS_OPTIONS.includes(Number(patch.rounds))) s.rounds = Number(patch.rounds);
    if (typeof patch.fastMoney === 'boolean') s.fastMoney = patch.fastMoney;
    if (typeof patch.phones === 'boolean') s.phones = patch.phones;
    if (patch.teamNames && typeof patch.teamNames === 'object') {
      s.teamNames = { ...s.teamNames };
      for (const team of TEAMS) {
        if (patch.teamNames[team] !== undefined) s.teamNames[team] = custom.clean(patch.teamNames[team], MAX_TEAM_NAME);
      }
    }
    this.settings = s;
  }

  /* ---------- Questions ---------- */

  setGroupHistory(history) {
    this.groupHistory = history ?? NO_HISTORY;
  }

  /** How a question is remembered for «👥 الشلة». */
  playKey(question) {
    return question.id;
  }

  unitCount() {
    return this.bank.length;
  }

  /** Questions not asked in this room yet (all of them again once they run out), and new to the room's group. */
  draw(count, minAnswers = MIN_ANSWERS, avoid = new Set()) {
    const usable = this.bank.filter((q) => q.answers.length >= minAnswers && !avoid.has(q.id));
    let fresh = usable.filter((q) => !this.seen.has(q.id));
    if (fresh.length < count) {
      for (const q of usable) this.seen.delete(q.id);
      fresh = usable;
    }
    fresh = preferNew(fresh, count, this.groupHistory, (q) => this.playKey(q), usable);
    const picks = shuffle(fresh, this.random).slice(0, count);
    for (const q of picks) this.seen.add(q.id);
    return picks;
  }

  /* ---------- Game flow ---------- */

  isStale(step) {
    return step !== undefined && step !== this.step;
  }

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (this.settings.phones && (!teamSize(this.teams, 'red') || !teamSize(this.teams, 'blue'))) {
      throw new GameError('كل فريق يحتاج لاعب واحد على الأقل');
    }
    if (this.bank.length < this.settings.rounds) throw new GameError('ما فيه أسئلة كفاية');
    this.reset();
    this.beginRound();
  }

  multiplier(round = this.roundNumber) {
    return round === this.settings.rounds ? 2 : 1;
  }

  beginRound() {
    this.roundNumber += 1;
    const [question] = this.draw(1);
    if (question) this.groupHistory.add([this.playKey(question)]);
    this.round = {
      question,
      revealed: [], // slot indexes, in the order they opened
      faceoff: { players: { red: this.nextPlayer('red'), blue: this.nextPlayer('blue') }, buzz: null, turn: null, tries: [] },
      control: null, // won the face-off
      playing: null, // naming answers now
      strikes: 0,
      result: null,
    };
    this.history = [];
    this.phase = 'faceoff';
    this.step += 1;
  }

  /** The round's points so far: every open slot, times the round's multiplier. */
  pot() {
    if (!this.round) return 0;
    const { answers } = this.round.question;
    return this.round.revealed.reduce((sum, i) => sum + answers[i].points, 0) * this.multiplier();
  }

  /** The host's mistakes can be taken back, one action at a time, within the round. */
  snapshot() {
    this.history.push(JSON.stringify({ phase: this.phase, round: this.round }));
    if (this.history.length > 30) this.history.shift();
  }

  undo(step) {
    if (this.isStale(step)) return;
    const last = this.history.pop();
    if (!last) throw new GameError('ما فيه شي ترجعه');
    const { phase, round } = JSON.parse(last);
    this.phase = phase;
    this.round = round;
    this.step += 1;
  }

  /** First press on a face-off phone wins the right to answer. */
  buzz(playerId) {
    if (this.phase !== 'faceoff') throw new GameError('مو وقت البازر');
    const f = this.round.faceoff;
    if (f.buzz) throw new GameError('سبقك أحد');
    const team = this.teams.get(playerId);
    if (!team || f.players[team] !== playerId) throw new GameError('البازر للي في المواجهة بس');
    f.buzz = { team, playerId, at: this.now() };
    f.turn = team;
    this.step += 1;
  }

  /** The host says who was first (no phones, or a phone that's away). */
  hostBuzz(team, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'faceoff') throw new GameError('مو وقت البازر');
    if (!TEAMS.includes(team)) throw new GameError('فريق غير معروف');
    this.snapshot();
    const f = this.round.faceoff;
    f.buzz = { team, playerId: null, at: this.now() };
    f.turn = team;
    this.step += 1;
  }

  /** The face-off is over: the better answer (the lowest slot) wins control. */
  settleFaceoff() {
    const f = this.round.faceoff;
    const last = f.tries.at(-1);
    if (f.tries.length === 1 && last.slot === 0) {
      this.round.control = last.team;
    } else if (f.tries.length === 1) {
      f.turn = other(last.team);
      return;
    } else {
      const hits = f.tries.filter((t) => t.slot !== null).sort((a, b) => a.slot - b.slot);
      if (!hits.length) {
        // Neither found anything: buzz again.
        f.buzz = null;
        f.turn = null;
        f.tries = [];
        return;
      }
      this.round.control = hits[0].team;
    }
    this.phase = 'choose';
  }

  /** The host opens the slot of the answer just given. */
  reveal(slot, step) {
    if (this.isStale(step)) return;
    const { round } = this;
    if (!round || !['faceoff', 'play', 'steal'].includes(this.phase)) throw new GameError('مو وقت الأجوبة');
    if (!Number.isInteger(slot) || slot < 0 || slot >= round.question.answers.length) throw new GameError('خانة غير معروفة');
    if (round.revealed.includes(slot)) throw new GameError('هذا الجواب مفتوح من قبل');
    if (this.phase === 'faceoff' && !round.faceoff.turn) throw new GameError('أول شي البازر');
    this.snapshot();
    round.revealed.push(slot);
    if (this.phase === 'faceoff') {
      round.faceoff.tries.push({ team: round.faceoff.turn, slot });
      this.settleFaceoff();
    } else if (this.phase === 'steal') {
      this.endRound(other(round.playing), 'steal');
    } else if (round.revealed.length === round.question.answers.length) {
      this.endRound(round.playing, 'cleared');
    }
    this.step += 1;
  }

  /** ❌: the answer isn't on the board. */
  miss(step) {
    if (this.isStale(step)) return;
    const { round } = this;
    if (!round || !['faceoff', 'play', 'steal'].includes(this.phase)) throw new GameError('مو وقت الأجوبة');
    if (this.phase === 'faceoff' && !round.faceoff.turn) throw new GameError('أول شي البازر');
    this.snapshot();
    if (this.phase === 'faceoff') {
      round.faceoff.tries.push({ team: round.faceoff.turn, slot: null });
      this.settleFaceoff();
    } else if (this.phase === 'play') {
      round.strikes += 1;
      if (round.strikes >= STRIKES) this.phase = 'steal';
    } else {
      this.endRound(round.playing, 'held');
    }
    this.step += 1;
  }

  /** The face-off winners play the board, or pass it to the other team. */
  choose(play, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'choose') throw new GameError('مو وقت الاختيار');
    this.snapshot();
    const { round } = this;
    round.playing = play ? round.control : other(round.control);
    round.strikes = 0;
    this.phase = 'play';
    if (round.revealed.length === round.question.answers.length) this.endRound(round.playing, 'cleared');
    this.step += 1;
  }

  endRound(winner, reason) {
    const points = this.pot();
    this.score[winner] += points;
    this.round.result = { winner, points, reason };
    this.phase = 'roundOver';
  }

  next(step) {
    if (this.isStale(step)) return;
    if (this.phase === 'roundOver') {
      if (this.roundNumber < this.settings.rounds) this.beginRound();
      else this.finishRounds();
      return;
    }
    if (this.phase === 'fastReview') {
      this.nextFast();
      return;
    }
    throw new GameError('مو وقت التالي');
  }

  finishRounds() {
    const { red, blue } = this.score;
    this.matchWinner = red === blue ? null : red > blue ? 'red' : 'blue';
    this.round = null;
    this.history = [];
    const questions = this.matchWinner && this.settings.fastMoney ? this.draw(FAST_QUESTIONS, FAST_MIN_ANSWERS) : [];
    if (questions.length === FAST_QUESTIONS) {
      const team = this.matchWinner;
      const line = [this.nextPlayer(team), ...this.queue[team].slice(1)];
      this.fast = {
        team,
        players: [line[0] ?? null, line[1] ?? line[0] ?? null],
        questions,
        stage: 0,
        answers: [Array(FAST_QUESTIONS).fill(''), Array(FAST_QUESTIONS).fill('')],
        matches: [Array(FAST_QUESTIONS).fill(null), Array(FAST_QUESTIONS).fill(null)],
        marked: [Array(FAST_QUESTIONS).fill(false), Array(FAST_QUESTIONS).fill(false)], // the host picked the match
        shown: [0, 0], // answers shown on the big screen in each review
        endsAt: null,
        total: 0,
        won: null,
      };
      this.phase = 'fastSetup';
    } else {
      this.phase = 'final';
    }
    this.step += 1;
  }

  /* ---------- «المال السريع» ---------- */

  setFastPlayer(index, playerId, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'fastSetup') throw new GameError('مو وقت اختيار اللاعبين');
    if (![0, 1].includes(index) || this.teams.get(playerId) !== this.fast.team) throw new GameError('اختر لاعب من الفريق الفايز');
    this.fast.players[index] = playerId;
    this.step += 1;
  }

  /** The clock starts for the player whose stage it is. */
  startFast(step) {
    if (this.isStale(step)) return;
    if (!['fastSetup', 'fastReview'].includes(this.phase)) throw new GameError('مو وقتها');
    const { fast } = this;
    if (this.phase === 'fastReview') {
      if (fast.stage !== 0 || fast.shown[0] < FAST_QUESTIONS) throw new GameError('اكشف أجوبة اللاعب الأول أول');
      fast.stage = 1;
    }
    if (fast.stage === 0) this.groupHistory.add(fast.questions.map((q) => this.playKey(q)));
    fast.endsAt = this.now() + FAST_SECONDS[fast.stage] * 1000;
    this.phase = 'fast';
    this.schedule(fast.endsAt - this.now() + TIMER_GRACE_MS, () => this.endFastStage());
    this.step += 1;
  }

  /**
   * The player's phone sends all five answers as they type (and the clock
   * ending takes whatever is there). The second player can't repeat the
   * first one's answer; returns which ones were repeats.
   */
  fastUpdate(playerId, answers) {
    if (this.phase !== 'fast') return { duplicates: [] };
    const { fast } = this;
    if (fast.players[fast.stage] !== playerId) throw new GameError('مو دورك');
    const duplicates = [];
    for (let i = 0; i < FAST_QUESTIONS; i++) {
      const text = custom.clean(Array.isArray(answers) ? answers[i] : '', MAX_ANSWER);
      if (fast.stage === 1 && text && key(text) === key(fast.answers[0][i])) {
        duplicates.push(i);
        fast.answers[1][i] = '';
      } else {
        fast.answers[fast.stage][i] = text;
      }
    }
    return { duplicates };
  }

  /** Done before the clock: «خلصت». */
  fastDone(playerId) {
    if (this.phase !== 'fast') return;
    if (this.fast.players[this.fast.stage] !== playerId) throw new GameError('مو دورك');
    this.endFastStage();
  }

  endFastStage() {
    if (this.phase !== 'fast') return;
    this.clearTimer();
    const { fast } = this;
    const s = fast.stage;
    for (let i = 0; i < FAST_QUESTIONS; i++) {
      if (!fast.marked[s][i]) fast.matches[s][i] = matchAnswer(fast.answers[s][i], fast.questions[i].answers);
    }
    fast.endsAt = null;
    this.phase = 'fastReview';
    this.step += 1;
  }

  /** The host corrects a match (or, with no phones, marks what the player said): a slot, or null for none. */
  fastMark(stage, index, slot, step) {
    if (this.isStale(step)) return;
    if (!['fast', 'fastReview'].includes(this.phase)) throw new GameError('مو وقتها');
    const { fast } = this;
    if (stage !== fast.stage || !Number.isInteger(index) || index < 0 || index >= FAST_QUESTIONS) throw new GameError('سؤال غير معروف');
    const answers = fast.questions[index].answers;
    if (slot !== null && (!Number.isInteger(slot) || slot < 0 || slot >= answers.length)) throw new GameError('جواب غير معروف');
    if (slot !== null && stage === 1 && fast.matches[0][index] === slot) throw new GameError('هذا نفس جواب اللاعب الأول');
    fast.matches[stage][index] = slot;
    fast.marked[stage][index] = true;
    if (!fast.answers[stage][index] && slot !== null) fast.answers[stage][index] = answers[slot].a;
    this.step += 1;
  }

  /** The big screen shows the next answer of the review, or moves on once all are shown. */
  nextFast() {
    const { fast } = this;
    if (fast.shown[fast.stage] < FAST_QUESTIONS) {
      fast.shown[fast.stage] += 1;
    } else if (fast.stage === 1) {
      fast.total = this.fastTotal();
      fast.won = fast.total >= FAST_TARGET;
      this.phase = 'final';
    } else {
      throw new GameError('ابدأ وقت اللاعب الثاني');
    }
    this.step += 1;
  }

  fastPoints(stage, index) {
    const slot = this.fast.matches[stage][index];
    return slot === null ? 0 : this.fast.questions[index].answers[slot].points;
  }

  fastTotal() {
    let total = 0;
    for (const s of [0, 1]) for (let i = 0; i < FAST_QUESTIONS; i++) total += this.fastPoints(s, i);
    return total;
  }

  /* ---------- End ---------- */

  finish() {
    if (this.phase === 'lobby') throw new GameError('اللعبة ما بدأت');
    this.clearTimer();
    if (!['fastSetup', 'fast', 'fastReview', 'final'].includes(this.phase)) {
      const { red, blue } = this.score;
      this.matchWinner = red === blue ? null : red > blue ? 'red' : 'blue';
    }
    if (this.fast && this.fast.won === null) this.fast = null;
    this.round = null;
    this.phase = 'final';
    this.step += 1;
  }

  restart() {
    this.reset();
  }

  nightPoints() {
    const { red, blue } = this.score;
    if (!this.matchWinner && red + blue === 0) return {};
    return teamPoints(this.teams, this.matchWinner);
  }

  /* ---------- Timers ---------- */

  schedule(ms, action) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        action();
      } catch {
        return;
      }
      this.onTimeout();
    }, Math.max(0, ms));
    this.timer.unref?.();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose() {
    this.clearTimer();
  }
}

module.exports = {
  FeudGame, matchAnswer, ROUNDS_OPTIONS, STRIKES, FAST_QUESTIONS, FAST_SECONDS, FAST_TARGET, MIN_ANSWERS,
};
