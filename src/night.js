'use strict';

// «بطل السهرة»: points that add up over every game a room plays tonight.
// Each game says who earned what when it ends (nightPoints()); the room adds
// it once per finished game.

const WIN_POINTS = 3;
const RANK_POINTS = { 1: 3, 2: 2, 3: 1 };

/** Individual games: 3 for first place, 2 for second, 1 for third (ties share). */
function rankedPoints(standings) {
  const points = {};
  for (const row of standings) {
    if (row.score > 0 && RANK_POINTS[row.rank]) points[row.id] = RANK_POINTS[row.rank];
  }
  return points;
}

/** Team games: 3 each to the winning team, 1 each on a draw. */
function teamPoints(teams, winner) {
  const points = {};
  for (const [id, team] of teams) {
    if (!winner) points[id] = 1;
    else if (team === winner) points[id] = WIN_POINTS;
  }
  return points;
}

class NightBoard {
  constructor() {
    this.rows = new Map(); // playerId → { points, wins }
    this.settled = false; // the current game's points are in
    this.crowned = false; // the champion screen is showing
  }

  /** Adds the game's points the first time it reaches the end. Returns true when it did. */
  settle(game) {
    if (game.phase !== 'final') {
      this.settled = false;
      return false;
    }
    if (this.settled) return false;
    this.settled = true;
    this.lastPoints = game.nightPoints?.() ?? {}; // this game's own points, for «👥 الشلة»'s ranking
    for (const [id, n] of Object.entries(this.lastPoints)) {
      if (!n) continue;
      const row = this.rows.get(id) ?? { points: 0, wins: 0 };
      row.points += n;
      if (n >= WIN_POINTS) row.wins += 1;
      this.rows.set(id, row);
    }
    return true;
  }

  remove(playerId) {
    this.rows.delete(playerId);
  }

  reset() {
    this.rows.clear();
    this.crowned = false;
  }

  crown(on) {
    this.crowned = Boolean(on) && this.rows.size > 0;
  }

  /** [{ id, name, points, wins, rank }] best first, for players still in the room. */
  standings(players) {
    const rows = players
      .filter((p) => this.rows.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, ...this.rows.get(p.id) }))
      .sort((a, b) => b.points - a.points || b.wins - a.wins);
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      row.rank = prev && prev.points === row.points && prev.wins === row.wins ? prev.rank : i + 1;
    });
    return rows;
  }

  view(players) {
    return { standings: this.standings(players), crowned: this.crowned };
  }
}

module.exports = { NightBoard, rankedPoints, teamPoints, WIN_POINTS };
