'use strict';

// «حروف» — two teams race across a board of 25 hexagons, each holding an
// Arabic letter. A picked letter brings a question whose answer starts with
// it; players buzz from their phones, and the first right answer takes the
// cell. 🔴 connects the left and right sides, 🔵 connects top and bottom;
// the first team to link its sides wins the round. The host judges.

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { teamPoints } = require('../night');
const custom = require('../custom');
const { otherTeam, teamSize, joinTeam, moveToTeam, shuffleTeams } = require('./teams');
const { normalizeAnswer } = require('../normalize');
const { NO_HISTORY, preferNew } = require('../groups');

/** How a question is remembered for «👥 الشلة»; the host's own (and their banks') aren't. */
const playKey = (letter, q) => (q.custom ? null : `${letter}:${normalizeAnswer(q.q)}`);

const SIZE = 5; // 5 × 5 cells
const ROUNDS_TO_WIN_OPTIONS = [1, 2, 3, 4];
const ANSWER_SECONDS = 10; // shown after a buzz; the host still decides

/** Rows are offset: odd rows sit half a cell to the right. */
function neighbours(index) {
  const r = Math.floor(index / SIZE);
  const c = index % SIZE;
  const shift = r % 2; // odd rows reach one column further right above and below
  const around = [[r, c - 1], [r, c + 1], [r - 1, c - 1 + shift], [r - 1, c + shift], [r + 1, c - 1 + shift], [r + 1, c + shift]];
  return around.filter(([y, x]) => y >= 0 && y < SIZE && x >= 0 && x < SIZE).map(([y, x]) => y * SIZE + x);
}

/** The cells of a path linking the team's two sides, or null. */
function winningPath(owners, team) {
  const starts = [];
  for (let i = 0; i < SIZE; i++) {
    const cell = team === 'red' ? i * SIZE : i; // red: left column, blue: top row
    if (owners[cell] === team) starts.push(cell);
  }
  const reached = (cell) => (team === 'red' ? cell % SIZE === SIZE - 1 : Math.floor(cell / SIZE) === SIZE - 1);
  const from = new Map(starts.map((s) => [s, null]));
  const queue = [...starts];
  while (queue.length) {
    const cell = queue.shift();
    if (reached(cell)) {
      const path = [];
      for (let at = cell; at !== null; at = from.get(at)) path.push(at);
      return path.reverse();
    }
    for (const next of neighbours(cell)) {
      if (owners[next] === team && !from.has(next)) {
        from.set(next, cell);
        queue.push(next);
      }
    }
  }
  return null;
}

class LettersGame {
  /** letters: [{ letter, questions: [{ q, a }] }] */
  constructor({ categories = [], random = Math.random, now = Date.now, groupHistory = NO_HISTORY } = {}) {
    this.bank = categories.filter((l) => l.questions.length);
    this.groupHistory = groupHistory; // «👥 الشلة»: questions the room's group has had on other nights
    this.letters = this.bank;
    this.custom = { text: '', items: [], bad: 0 }; // «أسئلتكم الخاصة»
    this.bankQuestions = []; // from the host's banks («بنوكي»)
    this.random = random;
    this.now = now;
    this.settings = { roundsToWin: 2 };
    this.teams = new Map(); // playerId → 'red' | 'blue'
    this.seen = new Map(); // letter → Set of question indexes asked in this room
    this.firstTeam = 'red';
    this.reset();
  }

  reset() {
    this.phase = 'lobby'; // lobby → pick → question ⇄ answer (→ missed) → pick … → roundOver → … → final
    this.score = { red: 0, blue: 0 };
    this.roundNumber = 0;
    this.matchWinner = null;
    this.board = []; // [{ letter, owner }]
    this.picker = this.firstTeam;
    this.roundStarter = this.firstTeam;
    this.current = null;
    this.result = null;
    this.history = [];
    this.step = 0; // counts actions, so a repeated tap on an old screen can be told apart
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

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    if (ROUNDS_TO_WIN_OPTIONS.includes(Number(patch.roundsToWin))) this.settings = { ...this.settings, roundsToWin: Number(patch.roundsToWin) };
    if (patch.custom !== undefined) this.setCustom(patch.custom);
  }

  /* ---------- Game flow ---------- */

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (!teamSize(this.teams, 'red') || !teamSize(this.teams, 'blue')) throw new GameError('كل فريق يحتاج لاعب واحد على الأقل');
    if (this.letters.length < SIZE * SIZE) throw new GameError('ما فيه حروف كفاية');
    this.reset();
    this.newRound();
  }

  newRound() {
    this.roundNumber += 1;
    this.board = shuffle(this.letters, this.random).slice(0, SIZE * SIZE).map((l) => ({ letter: l.letter, owner: null }));
    this.picker = this.roundStarter;
    this.current = null;
    this.result = null;
    this.history = [];
    this.phase = 'pick';
  }

  isStale(step) {
    return step !== undefined && step !== this.step;
  }

  /** Lines of «السؤال | الجواب»; each goes to the letter its answer starts with. */
  setCustom(text) {
    const items = [];
    let bad = 0;
    for (const line of custom.lines(text)) {
      const parts = custom.splitLine(line);
      const letter = parts?.length === 2 ? custom.letterOf(parts[1]) : null;
      if (!letter) {
        bad += 1;
        continue;
      }
      items.push({ letter, q: custom.clean(parts[0], custom.MAX_QUESTION), a: custom.clean(parts[1], custom.MAX_ANSWER) });
    }
    this.custom = { text: String(text ?? '').slice(0, 20000), items, bad };
    this.rebuildLetters();
  }

  setGroupHistory(history) {
    this.groupHistory = history ?? NO_HISTORY;
  }

  unitCount() {
    return this.bank.reduce((n, l) => n + l.questions.length, 0);
  }

  /** The host's banks: their questions come first for their letters, after the room's own. */
  setBanks(list) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر البنوك أثناء اللعب');
    this.bankQuestions = list.flat();
    this.rebuildLetters();
  }

  rebuildLetters() {
    const extra = [...this.custom.items, ...this.bankQuestions];
    this.letters = this.bank.map((l) => {
      const mine = extra.filter((i) => i.letter === l.letter).map(({ q, a }) => ({ q, a, custom: true }));
      return mine.length ? { ...l, questions: [...mine, ...l.questions] } : l;
    });
    this.seen.clear(); // question numbers moved
  }

  /** A question for the letter that nobody in this room has had yet, while there are any; the host's own first. */
  drawQuestion(letter, avoid = null) {
    const { questions } = this.letters.find((l) => l.letter === letter);
    const seen = this.seen.get(letter) ?? new Set();
    const mine = questions.map((q, i) => (q.custom && !seen.has(i) && i !== avoid ? i : -1)).filter((i) => i >= 0);
    if (mine.length) {
      seen.add(mine[0]);
      this.seen.set(letter, seen);
      return mine[0];
    }
    let pool = questions.map((_, i) => i).filter((i) => !seen.has(i) && i !== avoid);
    if (!pool.length) {
      seen.clear();
      pool = questions.map((_, i) => i).filter((i) => i !== avoid);
      if (!pool.length) pool = [0];
    }
    pool = preferNew(pool, 1, this.groupHistory, (i) => playKey(letter, questions[i]), questions.map((_, i) => i));
    const index = pool[Math.floor(this.random() * pool.length)];
    seen.add(index);
    this.seen.set(letter, seen);
    this.groupHistory.add([playKey(letter, questions[index])]);
    return index;
  }

  save() {
    this.history.push(JSON.stringify({
      phase: this.phase,
      owners: this.board.map((c) => c.owner),
      picker: this.picker,
      current: this.current && { ...this.current, locked: [...this.current.locked] },
      score: this.score,
      result: this.result,
      matchWinner: this.matchWinner,
    }));
  }

  /** The picking team chose a letter (the host taps it). */
  pick(cell, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'pick') throw new GameError('مو وقت اختيار حرف');
    const target = this.board[cell];
    if (!target) throw new GameError('الخلية مو موجودة');
    if (target.owner) throw new GameError('هذا الحرف انأخذ');
    this.current = { cell, letter: target.letter, question: this.drawQuestion(target.letter), locked: new Set(), buzz: null };
    this.phase = 'question';
    this.step += 1;
  }

  /** First press wins; a team that already missed this question can't buzz again. */
  buzz(playerId) {
    if (this.phase !== 'question') return false;
    const team = this.teams.get(playerId);
    if (!team || this.current.locked.has(team)) return false;
    this.current.buzz = { playerId, team, endsAt: this.now() + ANSWER_SECONDS * 1000 };
    this.phase = 'answer';
    this.step += 1;
    return true;
  }

  /** For players without a phone: the host gives the turn to a team. */
  hostBuzz(team, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'question') throw new GameError('مو وقت البازر');
    if (!['red', 'blue'].includes(team)) throw new GameError('فريق غير معروف');
    if (this.current.locked.has(team)) throw new GameError('هالفريق جاوب غلط على هالسؤال');
    this.current.buzz = { playerId: null, team, endsAt: this.now() + ANSWER_SECONDS * 1000 };
    this.phase = 'answer';
    this.step += 1;
  }

  judge(correct, step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'answer') throw new GameError('محد ضغط البازر');
    this.save();
    const { current } = this;
    const { team } = current.buzz;
    this.step += 1;
    if (!correct) {
      current.locked.add(team);
      current.buzz = null;
      this.phase = current.locked.size === 2 ? 'missed' : 'question';
      return;
    }
    this.board[current.cell].owner = team;
    this.picker = team;
    const path = winningPath(this.board.map((c) => c.owner), team);
    if (path) {
      this.score[team] += 1;
      this.result = { winner: team, path };
      if (this.score[team] >= this.settings.roundsToWin) this.matchWinner = team;
      this.roundStarter = otherTeam(this.roundStarter);
      this.phase = 'roundOver';
    } else {
      this.current = null;
      this.phase = 'pick';
    }
  }

  /** Nobody knows it: another question for the same letter, both teams can buzz again. */
  newQuestion(step) {
    if (this.isStale(step)) return;
    if (!['question', 'missed'].includes(this.phase)) throw new GameError('ما فيه سؤال');
    const { current } = this;
    current.question = this.drawQuestion(current.letter, current.question);
    current.locked = new Set();
    current.buzz = null;
    this.phase = 'question';
    this.step += 1;
  }

  /** Leave the cell open and go back to the board; the same team picks again. */
  release(step) {
    if (this.isStale(step)) return;
    if (!['question', 'missed'].includes(this.phase)) throw new GameError('ما فيه سؤال');
    this.current = null;
    this.phase = 'pick';
    this.step += 1;
  }

  /** Takes back the host's last ✅ / ❌. */
  undo(step) {
    if (this.isStale(step)) return;
    const last = this.history.pop();
    if (!last || this.phase === 'final') throw new GameError('ما فيه حكم تتراجع عنه');
    const s = JSON.parse(last);
    this.phase = s.phase;
    s.owners.forEach((owner, i) => { this.board[i].owner = owner; });
    this.picker = s.picker;
    this.current = s.current && { ...s.current, locked: new Set(s.current.locked) };
    if (this.current?.buzz) this.current.buzz.endsAt = this.now() + ANSWER_SECONDS * 1000;
    if (this.result?.winner && !s.result) this.roundStarter = otherTeam(this.roundStarter);
    this.score = s.score;
    this.result = s.result;
    this.matchWinner = s.matchWinner;
    this.step += 1;
  }

  next(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'roundOver') throw new GameError('الجولة ما خلصت');
    if (this.matchWinner) this.phase = 'final';
    else this.newRound();
    this.step += 1;
  }

  finish() {
    if (this.phase === 'lobby') throw new GameError('اللعبة ما بدأت');
    const { red, blue } = this.score;
    if (!this.matchWinner && red !== blue) this.matchWinner = red > blue ? 'red' : 'blue';
    this.current = null;
    this.phase = 'final';
    this.step += 1;
  }

  nightPoints() {
    const { red, blue } = this.score;
    if (!this.matchWinner && red + blue === 0) return {};
    return teamPoints(this.teams, this.matchWinner);
  }

  restart() {
    this.firstTeam = otherTeam(this.firstTeam);
    this.reset();
  }

  question() {
    if (!this.current) return null;
    return this.letters.find((l) => l.letter === this.current.letter).questions[this.current.question];
  }

  dispose() {}
}

module.exports = { LettersGame, SIZE, ROUNDS_TO_WIN_OPTIONS, ANSWER_SECONDS, neighbours, winningPath };
