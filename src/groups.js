'use strict';

// «👥 الشلة»: groups people play with («ولاد خالتي»). The owner adds members
// by username, and any of them can open a room with the group. A group
// remembers the questions it has had, so its rooms ask new ones night after
// night (another group, or none, can get them again), and keeps its own
// ranking: every game it finishes adds that game's «بطل السهرة» points.

const { GameError } = require('./errors');
const custom = require('./custom');
const { normalizeAnswer } = require('./normalize');

const LIMITS = { groups: 30, name: 30, members: 50 };

/** Players are ranked by name, so «أبو فهد» and «ابو فهد» are the same person (an all-emoji name stays as typed). */
const nameKey = (name) => normalizeAnswer(name) || String(name ?? '').trim();

/** Ranking rows best first, with places (ties share): points, then wins. */
function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  let rank = 0;
  return sorted.map((row, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.points !== row.points || prev.wins !== row.wins) rank = i + 1;
    return { ...row, rank };
  });
}

/**
 * The questions one group has had in one game: key → when. A game asks has()
 * when it draws, add() when a question shows, and recycle() when a section has
 * nothing new left for the group, so that section starts over for it.
 */
class GroupHistory {
  constructor(entries = [], { onAdd = () => {}, onRecycle = () => {} } = {}) {
    this.played = new Map(entries);
    this.onAdd = onAdd;
    this.onRecycle = onRecycle;
  }

  get size() {
    return this.played.size;
  }

  has(key) {
    return key != null && this.played.has(key);
  }

  add(keys) {
    const fresh = [...new Set(keys)].filter((key) => key != null);
    if (!fresh.length) return;
    const now = Date.now();
    for (const key of fresh) this.played.set(key, now);
    this.onAdd(fresh);
  }

  recycle(keys) {
    const gone = [...new Set(keys)].filter((key) => this.played.has(key));
    if (!gone.length) return;
    for (const key of gone) this.played.delete(key);
    this.onRecycle(gone);
  }
}

/** A room without a group: nothing played, nothing remembered. */
const NO_HISTORY = Object.freeze({ size: 0, has: () => false, add: () => {}, recycle: () => {} });

/**
 * Prefers items the group hasn't had: of `fresh` (already free of this room's
 * own repeats), the ones not in `history`, when there are at least `need`.
 * Otherwise the section is new again for the group and `fresh` stands.
 * keyOf(item) is the item's play key; `section` lists the whole section's items.
 */
function preferNew(fresh, need, history, keyOf, section = fresh) {
  const unplayed = fresh.filter((item) => !history.has(keyOf(item)));
  if (unplayed.length >= need) return unplayed;
  history.recycle(section.map(keyOf));
  return fresh;
}

const groupName = (name) => {
  const clean = custom.clean(name, LIMITS.name);
  if (!clean) throw new GameError('اكتب اسم الشلة');
  return clean;
};

/** A group the account owns: for changing it. */
async function owned(store, accountId, id) {
  const group = await store.getGroup(Number(id));
  if (!group || group.accountId !== accountId) throw new GameError('ما لقينا الشلة');
  return group;
}

/** A group the account owns or is a member of: for playing with it and seeing it. */
async function access(store, accountId, id) {
  const group = await store.getGroup(Number(id));
  if (group && group.accountId === accountId) return group;
  if (group && (await store.groupMembers(group.id)).some((m) => m.accountId === accountId)) return group;
  throw new GameError('ما لقينا الشلة');
}

/** The account's groups (its own and the ones it's in): plays per game, members and ranking. */
async function list(store, accountId) {
  const [groups, counts] = await Promise.all([store.listGroups(accountId), store.groupCounts(accountId)]);
  return Promise.all(groups.map(async (g) => {
    const games = counts[g.id] ?? {};
    const [members, scores] = await Promise.all([store.groupMembers(g.id), store.groupScores(g.id)]);
    return {
      id: g.id,
      name: g.name,
      ownerName: g.ownerName,
      mine: g.accountId === accountId,
      members: members.map((m) => ({ accountId: m.accountId, username: m.username })),
      playedAt: g.playedAt,
      games,
      total: Object.values(games).reduce((a, b) => a + b, 0),
      ranking: rankRows(scores).map(({ name, points, wins, games: played, rank }) => ({ name, points, wins, games: played, rank })),
    };
  }));
}

async function create(store, accountId, name) {
  const clean = groupName(name);
  const groups = (await store.listGroups(accountId)).filter((g) => g.accountId === accountId);
  if (groups.length >= LIMITS.groups) throw new GameError(`بالكثير ${LIMITS.groups} شلة لكل حساب`);
  if (groups.some((g) => g.name === clean)) throw new GameError('عندك شلة بنفس الاسم');
  return store.createGroup(accountId, clean);
}

async function rename(store, accountId, id, name) {
  const group = await owned(store, accountId, id);
  return store.renameGroup(group.id, groupName(name));
}

async function reset(store, accountId, id) {
  const group = await owned(store, accountId, id);
  await store.resetGroup(group.id);
}

async function remove(store, accountId, id) {
  const group = await owned(store, accountId, id);
  await store.deleteGroup(group.id);
}

async function addMember(store, accountId, id, username) {
  const group = await owned(store, accountId, id);
  const account = await store.findAccount(custom.clean(username, 40));
  if (!account) throw new GameError('ما لقينا حساب بهالاسم');
  if (account.id === accountId) throw new GameError('أنت صاحب الشلة');
  const members = await store.groupMembers(group.id);
  if (members.some((m) => m.accountId === account.id)) throw new GameError(`${account.username} موجود في الشلة`);
  if (members.length >= LIMITS.members) throw new GameError(`بالكثير ${LIMITS.members} عضو`);
  await store.addGroupMember(group.id, account.id);
  return { accountId: account.id, username: account.username };
}

async function removeMember(store, accountId, id, memberId) {
  const group = await owned(store, accountId, id);
  await store.removeGroupMember(group.id, Number(memberId));
}

async function leave(store, accountId, id) {
  const group = await access(store, accountId, id);
  if (group.accountId === accountId) throw new GameError('أنت صاحب الشلة: تقدر تحذفها بدل ما تطلع');
  await store.removeGroupMember(group.id, accountId);
}

async function resetScores(store, accountId, id) {
  const group = await owned(store, accountId, id);
  await store.resetGroupScores(group.id);
}

async function removeScore(store, accountId, id, name) {
  const group = await owned(store, accountId, id);
  if (!(await store.removeGroupScore(group.id, nameKey(name)))) throw new GameError('هالاسم مو في الترتيب');
}

/** A group with everything it has played and its ranking, to play with in a room. */
async function load(store, accountId, id) {
  const group = await access(store, accountId, id);
  const [plays, scores] = await Promise.all([store.groupPlays(group.id), store.groupScores(group.id)]);
  return { id: group.id, name: group.name, plays, scores };
}

module.exports = {
  LIMITS, GroupHistory, NO_HISTORY, preferNew, nameKey, rankRows,
  list, create, rename, reset, remove, load, owned, access, addMember, removeMember, leave, resetScores, removeScore,
};
