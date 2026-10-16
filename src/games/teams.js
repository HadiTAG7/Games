'use strict';

// The two teams of the team games («تحدي الوقت» and «سين جيم»). Each game
// keeps a Map of playerId → 'red' | 'blue'; these keep it balanced.

const { GameError } = require('../errors');
const { shuffle } = require('../shuffle');

const TEAMS = ['red', 'blue'];
const otherTeam = (team) => (team === 'red' ? 'blue' : 'red');

function teamSize(teams, team) {
  return [...teams.values()].filter((t) => t === team).length;
}

/** New players join the smaller team. */
function joinTeam(teams, playerId) {
  if (!teams.has(playerId)) teams.set(playerId, teamSize(teams, 'blue') < teamSize(teams, 'red') ? 'blue' : 'red');
}

function moveToTeam(teams, playerId, team) {
  if (!teams.has(playerId)) throw new GameError('اللاعب مو موجود');
  if (!TEAMS.includes(team)) throw new GameError('فريق غير معروف');
  teams.set(playerId, team);
}

function shuffleTeams(teams, random) {
  shuffle([...teams.keys()], random).forEach((id, i) => teams.set(id, i % 2 === 0 ? 'red' : 'blue'));
}

/** { red: [players], blue: [players] } in join order, for the screens. */
function teamsView(room) {
  const teams = Object.fromEntries(TEAMS.map((t) => [t, []]));
  for (const p of room.playerList()) {
    const team = room.game.teams.get(p.id);
    if (team) teams[team].push(p);
  }
  return teams;
}

module.exports = { TEAMS, otherTeam, teamSize, joinTeam, moveToTeam, shuffleTeams, teamsView };
