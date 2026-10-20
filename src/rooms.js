'use strict';

const crypto = require('crypto');
const { GameError } = require('./errors');
const { HerdGame } = require('./games/herd');
const { TimeGame } = require('./games/time');
const { SeenGame } = require('./games/seen');
const { LettersGame } = require('./games/letters');
const { OutsiderGame } = require('./games/outsider');
const { MafiaGame } = require('./games/mafia');
const { FeudGame } = require('./games/feud');
const herdViews = require('./games/herd-views');
const timeViews = require('./games/time-views');
const seenViews = require('./games/seen-views');
const lettersViews = require('./games/letters-views');
const outsiderViews = require('./games/outsider-views');
const mafiaViews = require('./games/mafia-views');
const feudViews = require('./games/feud-views');
const { normalizeAnswer } = require('./normalize');
const { NightBoard } = require('./night');
const { GroupHistory, NO_HISTORY } = require('./groups');

const MAX_PLAYERS = 40;
const MAX_NAME_LENGTH = 20;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const GAMES = {
  herd: { Game: HerdGame, views: herdViews, name: 'عقلية القطيع', emoji: '🐄' },
  time: { Game: TimeGame, views: timeViews, name: 'تحدي الوقت', emoji: '⏱️' },
  seen: { Game: SeenGame, views: seenViews, name: 'سين جيم', emoji: '❓' },
  letters: { Game: LettersGame, views: lettersViews, name: 'حروف', emoji: '🔤' },
  outsider: { Game: OutsiderGame, views: outsiderViews, name: 'برا السالفة', emoji: '🤫' },
  // «مافيا» needs no question file.
  mafia: { Game: MafiaGame, views: mafiaViews, name: 'مافيا', emoji: '🎭', needsContent: false },
  feud: { Game: FeudGame, views: feudViews, name: 'فاميلي فيود', emoji: '👪' },
};

function cleanName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) : '';
}

class Room {
  /** content: { herd, time, seen, letters }: each game's questions or cards */
  /** onGroupPlay / onGroupRecycle(groupId, game, keys): «👥 الشلة» has had these questions / starts these over. */
  constructor({ code, content, random, onSurvey = () => {}, onGroupPlay = () => {}, onGroupRecycle = () => {} }) {
    this.code = code;
    this.content = content;
    this.random = random;
    this.onSurvey = onSurvey;
    this.onGroupPlay = onGroupPlay;
    this.onGroupRecycle = onGroupRecycle;
    this.hostToken = crypto.randomBytes(16).toString('hex');
    this.players = new Map(); // id → { id, name, sockets: Set<socketId>, joinedAt }
    this.onChange = () => {};
    this.night = new NightBoard(); // «بطل السهرة» across every game played here
    // «بنوكي»: the logged-in host's own question banks.
    this.ownerId = null;
    this.ownerName = null;
    this.bankList = []; // the owner's banks, all games: [{ id, game, name, emoji, count, playable }]
    this.bankOn = {}; // game → ids of the banks switched on
    this.bankContent = {}; // game → those banks as game content
    // «👥 الشلة»: the owner's group playing tonight, and what it has had in each game.
    this.groupList = []; // the owner's groups: [{ id, name }]
    this.group = null; // { id, name, histories: { game: GroupHistory } }
    this.gameType = 'herd';
    this.game = this.createGame('herd');
    this.touch();
  }

  createGame(type) {
    const { Game } = GAMES[type];
    const game = new Game({
      categories: this.content[type] ?? [],
      random: this.random,
      onTimeout: () => this.onChange(),
      onSurvey: (r) => this.onSurvey(r),
      groupHistory: this.historyFor(type),
    });
    for (const id of this.players.keys()) game.addPlayer(id);
    return game;
  }

  /** Switch games between games; everyone stays in the room. */
  /** The games this room can play: the ones whose questions are loaded. */
  games() {
    return Object.entries(GAMES)
      .filter(([id, g]) => g.needsContent === false || (this.content[id] ?? []).length > 0)
      .map(([id, g]) => ({ id, name: g.name, emoji: g.emoji }));
  }

  setGameType(type) {
    if (!this.games().some((g) => g.id === type)) throw new GameError('لعبة غير معروفة');
    if (type === this.gameType) return;
    if (!['lobby', 'final'].includes(this.game.phase)) throw new GameError('خلّص اللعبة الحالية أول');
    this.game.dispose();
    this.gameType = type;
    this.game = this.createGame(type);
    this.applyBanks();
  }

  /* ---------- «👥 الشلة» ---------- */

  historyFor(type) {
    return this.group?.histories[type] ?? NO_HISTORY;
  }

  /** Plays tonight with a group (from groups.load: { id, name, plays: { game: [[key, at]] } }), or with none. */
  setGroup(loaded) {
    if (!['lobby', 'final'].includes(this.game.phase)) throw new GameError('خلّص اللعبة الحالية أول');
    this.group = loaded && {
      id: loaded.id,
      name: loaded.name,
      histories: Object.fromEntries(Object.keys(GAMES).map((game) => [game, new GroupHistory(loaded.plays[game] ?? [], {
        onAdd: (keys) => this.onGroupPlay(loaded.id, game, keys),
        onRecycle: (keys) => this.onGroupRecycle(loaded.id, game, keys),
      })])),
    };
    this.game.setGroupHistory?.(this.historyFor(this.gameType));
  }

  /** What the lobby shows of «👥 الشلة». */
  groupView() {
    const current = this.group && {
      id: this.group.id,
      name: this.group.name,
      played: this.historyFor(this.gameType).size,
      total: this.game.unitCount?.() ?? 0,
    };
    return { loggedIn: Boolean(this.ownerId), applies: Boolean(this.game.setGroupHistory), list: this.groupList, current };
  }

  /** Puts the banks switched on for the current game into it. */
  applyBanks() {
    if (this.game.setBanks) this.game.setBanks(this.bankContent[this.gameType] ?? []);
  }

  /** Switches the given banks on for the current game: list = [{ bank, content }] from banks.playableContent. */
  useBanks(list) {
    if (!this.game.setBanks) throw new GameError('هذي اللعبة ما فيها بنوك');
    if (!['lobby', 'final'].includes(this.game.phase)) throw new GameError('خلّص اللعبة الحالية أول');
    this.bankOn[this.gameType] = list.map((x) => x.bank.id);
    this.bankContent[this.gameType] = list.map((x) => x.content);
    this.applyBanks();
  }

  /** What the lobby shows of «بنوكي» for the current game. */
  banksView() {
    if (!this.game.setBanks) return null;
    const on = this.bankOn[this.gameType] ?? [];
    return {
      loggedIn: Boolean(this.ownerId),
      owner: this.ownerName,
      list: this.bankList.filter((b) => b.game === this.gameType).map((b) => ({ ...b, on: on.includes(b.id) })),
    };
  }

  /** Throws unless the room is playing the given game, so game-specific actions can't misfire. */
  gameOf(type) {
    if (this.gameType !== type) throw new GameError('هذا الإجراء مو لهذي اللعبة');
    return this.game;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  join({ name, playerId } = {}) {
    if (playerId && this.players.has(playerId)) return this.players.get(playerId);
    const clean = cleanName(name);
    if (!clean) throw new GameError('اكتب اسمك');
    const key = normalizeAnswer(clean);
    if ([...this.players.values()].some((p) => normalizeAnswer(p.name) === key)) {
      throw new GameError('الاسم مأخوذ، اختر اسم ثاني');
    }
    if (this.players.size >= MAX_PLAYERS) throw new GameError('الغرفة ممتلئة');
    const player = { id: crypto.randomUUID(), name: clean, sockets: new Set(), joinedAt: Date.now() };
    this.players.set(player.id, player);
    this.game.addPlayer(player.id);
    return player;
  }

  kick(playerId) {
    if (!this.players.has(playerId)) throw new GameError('اللاعب مو موجود');
    this.players.delete(playerId);
    this.night.remove(playerId);
    this.game.removePlayer(playerId);
    this.maybeAutoReveal();
    this.maybeFinishVote();
    this.maybeCloseOutsiderVote();
    this.maybeMoveMafia();
  }

  connect(playerId, socketId) {
    this.players.get(playerId)?.sockets.add(socketId);
  }

  disconnect(playerId, socketId) {
    this.players.get(playerId)?.sockets.delete(socketId);
    this.maybeFinishVote();
    this.maybeCloseOutsiderVote();
    this.maybeMoveMafia();
  }

  isConnected(playerId) {
    return (this.players.get(playerId)?.sockets.size ?? 0) > 0;
  }

  nameOf(playerId) {
    return playerId ? this.players.get(playerId)?.name ?? null : null;
  }

  /** [{ id, name, connected }] in join order. */
  playerList() {
    return [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, connected: p.sockets.size > 0 }));
  }

  /* ---------- «عقلية القطيع» room rules ---------- */

  /** Everyone connected may vote; the game leaves out the answer's authors. */
  startVote(groupId) {
    const connected = [...this.players.keys()].filter((id) => this.isConnected(id));
    this.gameOf('herd').startVote(groupId, connected);
  }

  castVote(playerId, choice) {
    this.gameOf('herd').castVote(playerId, choice);
    this.maybeFinishVote();
  }

  /** Close the vote once every voter who is still connected has voted. */
  maybeFinishVote() {
    if (this.gameType !== 'herd') return;
    const vote = this.game.round?.vote;
    if (!vote || vote.status !== 'open') return;
    const waiting = [...vote.eligible].some((id) => !vote.votes.has(id) && this.isConnected(id));
    if (!waiting) this.game.finishVote();
  }

  submitAnswer(playerId, payload) {
    this.gameOf('herd').submitAnswer(playerId, payload);
    this.maybeAutoReveal();
  }

  /** A phone's unsent answer; nothing on screen changes, so no broadcast. */
  saveDraft(playerId, draft) {
    if (this.gameType === 'herd') this.game.saveDraft(playerId, draft ?? {});
  }

  /** Reveal as soon as everyone who is still connected has answered. */
  maybeAutoReveal() {
    if (this.gameType !== 'herd') return;
    const { game } = this;
    if (game.phase !== 'question' || game.round.answers.size === 0) return;
    const waiting = [...this.players.values()].some(
      (p) => p.sockets.size > 0 && !game.round.answers.has(p.id),
    );
    if (!waiting) game.reveal();
  }

  /* ---------- «برا السالفة» room rules ---------- */

  outsiderVote(playerId, target) {
    this.gameOf('outsider').vote(playerId, target);
    this.maybeCloseOutsiderVote();
  }

  /** Count the votes once everyone still connected has voted. */
  maybeCloseOutsiderVote() {
    if (this.gameType !== 'outsider' || this.game.phase !== 'vote') return;
    const connected = [...this.players.keys()].filter((id) => this.isConnected(id));
    if (this.game.allVoted(connected)) this.game.closeVote();
  }

  /* ---------- «مافيا» room rules ---------- */

  connectedIds() {
    return [...this.players.keys()].filter((id) => this.isConnected(id));
  }

  mafiaPick(playerId, target) {
    this.gameOf('mafia').pick(playerId, target);
    this.maybeMoveMafia();
  }

  mafiaConfirm(playerId) {
    this.gameOf('mafia').confirmPick(playerId);
    this.maybeMoveMafia();
  }

  mafiaVote(playerId, target) {
    this.gameOf('mafia').castVote(playerId, target);
    this.maybeMoveMafia();
  }

  /** The night ends once everyone still connected is done; the vote once they've voted. */
  maybeMoveMafia() {
    if (this.gameType !== 'mafia') return;
    const { game } = this;
    if (game.phase === 'night') game.maybeEndNight(this.connectedIds());
    else if (game.phase === 'vote' && game.allVoted(this.connectedIds())) game.endVote();
  }

  /** Adds a finished game to «بطل السهرة»; called on every change. */
  settleNight() {
    return this.night.settle(this.game);
  }

  /* ---------- Views ---------- */

  commonView(role) {
    return {
      role,
      code: this.code,
      gameType: this.gameType,
      games: this.games(),
      serverTime: Date.now(),
      playerCount: this.players.size,
      night: this.night.view(this.playerList()),
      groupName: this.group?.name ?? null,
    };
  }

  // The room's own fields come last, so a game's view can't shadow them (say, «night»).
  hostView() {
    return { ...GAMES[this.gameType].views.hostView(this), ...this.commonView('host'), myBanks: this.banksView(), myGroup: this.groupView() };
  }

  playerView(playerId) {
    return { ...GAMES[this.gameType].views.playerView(this, playerId), ...this.commonView('player') };
  }

  dispose() {
    this.game.dispose();
  }
}

class RoomManager {
  /**
   * categories: «عقلية القطيع»; timeCategories: «تحدي الوقت»; seenCategories: «سين جيم»; letters: «حروف»;
   * outsiderCategories: «برا السالفة»; feudQuestions: «فاميلي فيود».
   */
  constructor({
    categories = [], timeCategories = [], seenCategories = [], letters = [], outsiderCategories = [], feudQuestions = [],
    random = Math.random,
  } = {}) {
    this.content = {
      herd: categories, time: timeCategories, seen: seenCategories, letters, outsider: outsiderCategories, feud: feudQuestions,
    };
    this.random = random;
    this.rooms = new Map();
    this.onSurvey = () => {}; // «استبيانكم»: the server stores confirmed «عقلية القطيع» rounds
    this.onGroupPlay = () => {}; // «👥 الشلة»: the server stores what each group has had
    this.onGroupRecycle = () => {};
  }

  /** Swap in a game's bank (say, after approving questions people sent); games started from now on use it. */
  setContent(type, list) {
    this.content[type] = list;
  }

  newCode() {
    for (let i = 0; i < 1000; i++) {
      const code = String(crypto.randomInt(1000, 10000));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('No free room codes');
  }

  create() {
    const room = new Room({
      code: this.newCode(),
      content: this.content,
      random: this.random,
      onSurvey: (r) => this.onSurvey(r),
      onGroupPlay: (...args) => this.onGroupPlay(...args),
      onGroupRecycle: (...args) => this.onGroupRecycle(...args),
    });
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code ?? '').trim());
  }

  cleanup(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = { Room, RoomManager, GAMES, MAX_PLAYERS, MAX_NAME_LENGTH, ROOM_TTL_MS };
