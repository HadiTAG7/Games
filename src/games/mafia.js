'use strict';

// «مافيا»: secret roles on the phones, and the big screen is the narrator.
// At night everyone picks someone on their phone (so nobody can tell who has
// a role); the mafia point at a victim and confirm it together (no agreement,
// no victim), the doctor saves someone, the police ask about someone, the
// sniper may fire their one bullet. By day the room talks, then votes
// someone out; the mayor's vote counts twice. «الانتحاري» plays for himself:
// voted out, he wins alone and the game ends.
//
// The night's outcome and the vote's are told as a story first (mafia-story.js);
// they only take effect once it's told, so no screen gives them away early.
//
// Phases: lobby → roles → night → morning → discuss → vote → verdict → night … → final

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');
const { WIN_POINTS } = require('../night');
const { nightStory, voteStory } = require('./mafia-story');

const MIN_PLAYERS = 5;
const SPECIAL_ROLES = ['doctor', 'police', 'mayor', 'sniper', 'jester']; // handed out in this order while there's room
const DISCUSS_OPTIONS = [0, 120, 180, 300];
const NIGHT_OPTIONS = [15, 30, 60];
const NIGHT_END_DELAY = [2000, 4000]; // after the last pick, so timing doesn't give anyone away
const TIMER_GRACE_MS = 400;

/** 5–7 players: one mafia, 8–11: two, 12+: three. */
function autoMafia(count) {
  if (count >= 12) return 3;
  if (count >= 8) return 2;
  return 1;
}

/** Did this role win? The jester is on nobody's side. */
function wonWith(role, winner) {
  if (role === 'jester' || winner === 'jester') return role === winner;
  return (role === 'mafia') === (winner === 'mafia');
}

class MafiaGame {
  constructor({ random = Math.random, now = Date.now, onTimeout = () => {} } = {}) {
    this.random = random;
    this.now = now;
    this.onTimeout = onTimeout;
    this.settings = {
      mafia: 0, // 0 = automatic by player count
      roles: { doctor: true, police: true, sniper: true, mayor: true, jester: true },
      revealOnDeath: true,
      discussSeconds: 180,
      nightSeconds: 60,
    };
    this.players = new Map(); // id → { role, alive }
    this.timer = null;
    this.reset();
  }

  reset() {
    this.clearTimer();
    this.phase = 'lobby';
    this.step = 0;
    this.dayNumber = 0;
    this.winner = null;
    this.night = null;
    this.vote = null;
    this.announcement = null;
    this.story = null; // { kind: 'night' | 'vote', beats, startedAt, endsAt, told, outcome }
    this.endsAt = null;
    this.lastSaved = null;
    this.bulletUsed = false;
    this.checks = []; // the police's answers: [{ night, target, mafia }]
    for (const id of this.players.keys()) this.players.set(id, { role: null, alive: true });
  }

  addPlayer(id) {
    // Someone joining mid-game watches until the next game.
    if (!this.players.has(id)) this.players.set(id, { role: null, alive: this.phase === 'lobby' });
  }

  removePlayer(id) {
    const player = this.players.get(id);
    this.players.delete(id);
    if (!player?.role || ['lobby', 'final'].includes(this.phase)) return;
    this.night?.picks.delete(id);
    this.night?.confirmed.delete(id);
    this.vote?.votes.delete(id);
    this.step += 1;
    this.checkWinner();
  }

  updateSettings(patch = {}) {
    if (!['lobby', 'final'].includes(this.phase)) throw new GameError('ما تقدر تغيّر الإعدادات أثناء اللعب');
    const s = { ...this.settings, roles: { ...this.settings.roles } };
    if ([0, 1, 2, 3].includes(Number(patch.mafia))) s.mafia = Number(patch.mafia);
    if (DISCUSS_OPTIONS.includes(Number(patch.discussSeconds))) s.discussSeconds = Number(patch.discussSeconds);
    if (NIGHT_OPTIONS.includes(Number(patch.nightSeconds))) s.nightSeconds = Number(patch.nightSeconds);
    if (typeof patch.revealOnDeath === 'boolean') s.revealOnDeath = patch.revealOnDeath;
    if (patch.roles && typeof patch.roles === 'object') {
      for (const role of SPECIAL_ROLES) if (typeof patch.roles[role] === 'boolean') s.roles[role] = patch.roles[role];
    }
    this.settings = s;
  }

  /** The roles a game with this many players would deal: { mafia, doctor, …, citizen }. */
  lineup(count = this.players.size) {
    const max = Math.max(1, Math.floor((count - 1) / 3));
    const mafia = Math.min(this.settings.mafia || autoMafia(count), max);
    const lineup = { mafia };
    let town = count - mafia;
    // Special roles go out while at least one plain citizen is left.
    for (const role of SPECIAL_ROLES) {
      if (this.settings.roles[role] && town > 1) {
        lineup[role] = 1;
        town -= 1;
      }
    }
    lineup.citizen = Math.max(0, town);
    return lineup;
  }

  /* ---------- Game flow ---------- */

  start() {
    if (this.phase !== 'lobby') throw new GameError('اللعبة بدأت');
    if (this.players.size < MIN_PLAYERS) throw new GameError(`تحتاجون ${MIN_PLAYERS} لاعبين على الأقل`);
    const ids = shuffle([...this.players.keys()], this.random);
    const deck = Object.entries(this.lineup(ids.length)).flatMap(([role, n]) => Array(n).fill(role));
    ids.forEach((id, i) => this.players.set(id, { role: deck[i], alive: true }));
    this.phase = 'roles';
    this.step += 1;
  }

  isStale(step) {
    return step !== undefined && step !== this.step;
  }

  alive() {
    return [...this.players].filter(([, p]) => p.alive && p.role).map(([id]) => id);
  }

  roleOf(id) {
    return this.players.get(id)?.role ?? null;
  }

  isMafia(id) {
    return this.roleOf(id) === 'mafia';
  }

  mayor() {
    return [...this.players].find(([, p]) => p.role === 'mayor' && p.alive)?.[0] ?? null;
  }

  /** Night falls: everyone alive picks someone on their phone. */
  startNight(step) {
    if (this.isStale(step)) return;
    if (!['roles', 'verdict'].includes(this.phase) || this.winner) throw new GameError('مو وقت الليل');
    this.ensureTold();
    this.dayNumber += 1;
    this.night = { picks: new Map(), confirmed: new Set(), ending: false };
    this.announcement = null;
    this.story = null;
    this.vote = null;
    this.phase = 'night';
    this.endsAt = this.now() + this.settings.nightSeconds * 1000;
    this.schedule(this.endsAt - this.now() + TIMER_GRACE_MS, () => this.endNight());
    this.step += 1;
  }

  /** Who this player may pick tonight, or why not. */
  checkPick(playerId, target) {
    const role = this.roleOf(playerId);
    const alive = this.alive();
    if (!alive.includes(playerId)) throw new GameError('أنت طالع من اللعبة');
    if (target === null) {
      if (role === 'sniper' && !this.bulletUsed) return; // holding the bullet
      throw new GameError('اختر لاعب');
    }
    if (!alive.includes(target)) throw new GameError('اختر لاعب باقي في اللعبة');
    if (role === 'doctor') {
      if (target === this.lastSaved) throw new GameError('ما تقدر تنقذ نفس الشخص ليلتين ورا بعض');
      return;
    }
    if (target === playerId) throw new GameError('اختر أحد غيرك');
    if (role === 'mafia' && this.isMafia(target)) throw new GameError('هذا من المافيا معك');
  }

  pick(playerId, target = null) {
    if (this.phase !== 'night') throw new GameError('مو وقت الليل');
    this.checkPick(playerId, target);
    // The police get their answer straight away, in secret, so their pick is final.
    if (this.roleOf(playerId) === 'police') {
      if (this.night.picks.has(playerId)) throw new GameError('سألت عن أحد الليلة خلاص');
      this.checks.push({ night: this.dayNumber, target, mafia: this.isMafia(target) });
    }
    // Pointing somewhere else than what the mafia agreed on undoes everyone's «اعتمد».
    if (this.isMafia(playerId) && target !== this.mafiaPlan().agreed) this.night.confirmed.clear();
    this.night.picks.set(playerId, target);
  }

  /** The mafia alive tonight. */
  mafiaAlive() {
    return this.alive().filter((id) => this.isMafia(id));
  }

  /**
   * Where the mafia stand tonight. With two or more alive, each points at
   * someone (the others see it); once all who pointed point at the same
   * person, each confirms, and only then is that person the victim. A lone
   * mafia's pick counts straight away.
   */
  mafiaPlan() {
    const mafia = this.mafiaAlive();
    const picks = this.night?.picks ?? new Map();
    const pointed = mafia.filter((id) => picks.get(id));
    const targets = new Set(pointed.map((id) => picks.get(id)));
    const agreed = targets.size === 1 ? [...targets][0] : null;
    const team = mafia.length > 1;
    const confirmed = agreed ? pointed.filter((id) => !team || this.night.confirmed.has(id)) : [];
    const locked = Boolean(agreed) && confirmed.length === pointed.length;
    return { team, pointed, agreed, confirmed, locked, victim: locked ? agreed : null };
  }

  /** «🔪 اعتمد»: a mafia confirms the person they all point at. */
  confirmPick(playerId) {
    if (this.phase !== 'night') throw new GameError('مو وقت الليل');
    if (!this.isMafia(playerId) || !this.players.get(playerId).alive) throw new GameError('هذا للمافيا بس');
    const plan = this.mafiaPlan();
    if (!plan.team) return; // alone, the pick already counts
    if (!plan.agreed || this.night.picks.get(playerId) !== plan.agreed) throw new GameError('اتفقوا على نفس الشخص أول');
    this.night.confirmed.add(playerId);
  }

  /** Done for tonight: picked, or for a mafia with a team, confirmed the agreed victim. */
  hasActed(id) {
    if (!this.night.picks.has(id)) return false;
    if (!this.isMafia(id)) return true;
    const plan = this.mafiaPlan();
    return !plan.team || (plan.locked && plan.confirmed.includes(id));
  }

  /** Once everyone still online is done, the night ends a few seconds later. */
  maybeEndNight(connected) {
    if (this.phase !== 'night' || this.night.ending) return;
    const online = new Set(connected);
    const waiting = this.alive().some((id) => online.has(id) && !this.hasActed(id));
    if (waiting) return;
    this.night.ending = true;
    const [min, max] = NIGHT_END_DELAY;
    this.schedule(min + this.random() * (max - min), () => this.endNight());
  }

  /**
   * Morning: the mafia's victim (if they agreed) and the sniper's shot fall,
   * unless the doctor saved them. The story of the night comes first.
   */
  endNight(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'night') throw new GameError('مو وقت الليل');
    this.clearTimer();
    const { picks } = this.night;
    const byRole = (role) => this.alive().filter((id) => this.roleOf(id) === role);
    const plan = this.mafiaPlan();
    const { victim } = plan;
    const [doctor] = byRole('doctor');
    const saved = doctor ? picks.get(doctor) ?? null : null;
    const [sniper] = byRole('sniper');
    const shot = sniper && !this.bulletUsed ? picks.get(sniper) ?? null : null;
    if (shot) this.bulletUsed = true;
    this.lastSaved = saved;
    const attacked = [...new Set([victim, shot].filter(Boolean))];
    const deaths = attacked.filter((id) => id !== saved);
    const story = nightStory({
      dayNumber: this.dayNumber, plan: { pointed: plan.pointed.length > 0, agreed: Boolean(plan.agreed) }, victim, shot, deaths, random: this.random,
    });
    this.night = null;
    this.endsAt = null;
    this.phase = 'morning';
    this.tellStory('night', story, { deaths, saved: attacked.length > deaths.length, shot: Boolean(shot) });
  }

  /** The story starts on every screen; the outcome holds until it's told (or the host skips it). */
  tellStory(kind, { beats, length }, outcome) {
    const startedAt = this.now();
    this.announcement = null;
    this.story = { kind, beats, startedAt, endsAt: startedAt + length, told: false, outcome };
    this.step += 1;
    this.schedule(length + TIMER_GRACE_MS, () => this.tell());
  }

  /** The story is over: the deaths, or the vote's outcome, take effect. */
  tell(step) {
    if (this.isStale(step)) return;
    if (!this.story || this.story.told) throw new GameError('مو وقتها');
    this.clearTimer();
    const { kind, outcome } = this.story;
    this.story.told = true;
    this.step += 1;
    if (kind === 'night') {
      const deaths = outcome.deaths.filter((id) => this.players.has(id)); // someone may have left meanwhile
      for (const id of deaths) this.players.get(id).alive = false;
      this.announcement = { kind: 'morning', deaths, saved: outcome.saved, shot: outcome.shot };
      this.checkWinner();
      return;
    }
    const out = outcome.out && this.players.has(outcome.out) ? outcome.out : null;
    if (out) this.players.get(out).alive = false;
    this.announcement = { kind: 'verdict', out, tally: outcome.tally, votes: outcome.votes };
    this.checkWinner(Boolean(out) && this.roleOf(out) === 'jester');
  }

  /** Nothing moves on while the story is still being told. */
  ensureTold() {
    if (this.story && !this.story.told) throw new GameError('استنوا القصة تخلص');
  }

  /** Talk it over, with a timer if the host set one. */
  startDiscussion(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'morning' || this.winner) throw new GameError('مو وقتها');
    this.ensureTold();
    this.phase = 'discuss';
    const seconds = this.settings.discussSeconds;
    this.endsAt = seconds ? this.now() + seconds * 1000 : null;
    if (seconds) this.schedule(this.endsAt - this.now() + TIMER_GRACE_MS, () => this.startVote());
    this.step += 1;
  }

  startVote(step) {
    if (this.isStale(step)) return;
    if (!['morning', 'discuss'].includes(this.phase) || this.winner) throw new GameError('مو وقت التصويت');
    this.ensureTold();
    this.clearTimer();
    this.endsAt = null;
    this.vote = { votes: new Map() }; // voter → target id, or 'none'
    this.phase = 'vote';
    this.step += 1;
  }

  castVote(playerId, target) {
    if (this.phase !== 'vote') throw new GameError('التصويت مو مفتوح');
    const alive = this.alive();
    if (!alive.includes(playerId)) throw new GameError('أنت طالع من اللعبة');
    if (target !== 'none') {
      if (target === playerId) throw new GameError('ما تقدر تصوّت على نفسك');
      if (!alive.includes(target)) throw new GameError('اختر لاعب باقي في اللعبة');
    }
    this.vote.votes.set(playerId, target);
  }

  allVoted(connected) {
    const online = new Set(connected);
    return this.alive().every((id) => this.vote.votes.has(id) || !online.has(id));
  }

  /** The most votes goes out (the mayor's count twice); a tie, or «ما نطلّع أحد» on top, and nobody does. Counted out loud first. */
  endVote(step) {
    if (this.isStale(step)) return;
    if (this.phase !== 'vote') throw new GameError('التصويت مو مفتوح');
    const mayor = this.mayor();
    const weights = new Map();
    for (const [voter, target] of this.vote.votes) {
      weights.set(target, (weights.get(target) ?? 0) + (voter === mayor ? 2 : 1));
    }
    const tally = [...weights].map(([target, votes]) => ({ target, votes })).sort((a, b) => b.votes - a.votes);
    const [first, second] = tally;
    const out = first && first.target !== 'none' && (!second || second.votes < first.votes) ? first.target : null;
    const votes = [...this.vote.votes].map(([voter, target]) => ({ voter, target }));
    const story = voteStory({ tally, out, role: out ? this.roleOf(out) : null, revealOnDeath: this.settings.revealOnDeath, random: this.random });
    this.phase = 'verdict';
    this.tellStory('vote', story, { out, tally, votes });
  }

  /**
   * The jester wins once voted out; otherwise the mafia win once they match
   * the rest (the jester counts with the rest), the town once the mafia are gone.
   */
  checkWinner(jesterOut = false) {
    if (['lobby', 'roles', 'final'].includes(this.phase)) return;
    if (this.story && !this.story.told) return; // decided once the story is told
    const alive = this.alive();
    const mafia = alive.filter((id) => this.isMafia(id)).length;
    if (jesterOut) this.winner = 'jester';
    else if (mafia === 0) this.winner = 'town';
    else if (mafia >= alive.length - mafia) this.winner = 'mafia';
    if (!this.winner) return;
    this.clearTimer();
    this.endsAt = null;
    this.night = null;
    // The morning or verdict stays on screen; «next» shows the final.
  }

  next(step) {
    if (this.isStale(step)) return;
    if (!this.winner) throw new GameError('اللعبة ما خلصت');
    this.ensureTold();
    this.phase = 'final';
    this.step += 1;
  }

  finish() {
    if (this.phase === 'lobby') throw new GameError('اللعبة ما بدأت');
    this.clearTimer();
    this.endsAt = null;
    this.phase = 'final';
    this.step += 1;
  }

  restart() {
    this.reset();
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

  nightPoints() {
    if (!this.winner) return {};
    const points = {};
    for (const [id, p] of this.players) if (p.role && wonWith(p.role, this.winner)) points[id] = WIN_POINTS;
    return points;
  }

  dispose() {
    this.clearTimer();
  }
}

module.exports = { MafiaGame, MIN_PLAYERS, SPECIAL_ROLES, DISCUSS_OPTIONS, NIGHT_OPTIONS, autoMafia, wonWith };
