'use strict';

// «👥 الشلة»: groups an account plays with («ولاد خالتي»). Each remembers the
// questions it has had, so a room playing with that group asks new ones, night
// after night. Another group, or no group, can get the same questions again.

const { GameError } = require('./errors');
const custom = require('./custom');

const LIMITS = { groups: 30, name: 30 };

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

async function owned(store, accountId, id) {
  const group = await store.getGroup(Number(id));
  if (!group || group.accountId !== accountId) throw new GameError('ما لقينا الشلة');
  return group;
}

/** The account's groups, with how many questions each has had per game. */
async function list(store, accountId) {
  const [groups, counts] = await Promise.all([store.listGroups(accountId), store.groupCounts(accountId)]);
  return groups.map((g) => {
    const games = counts[g.id] ?? {};
    return { id: g.id, name: g.name, playedAt: g.playedAt, games, total: Object.values(games).reduce((a, b) => a + b, 0) };
  });
}

async function create(store, accountId, name) {
  const clean = groupName(name);
  const groups = await store.listGroups(accountId);
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

/** A group and everything it has played, to play with in a room. */
async function load(store, accountId, id) {
  const group = await owned(store, accountId, id);
  return { id: group.id, name: group.name, plays: await store.groupPlays(group.id) };
}

module.exports = { LIMITS, GroupHistory, NO_HISTORY, preferNew, list, create, rename, reset, remove, load, owned };
