/* Shared by the team games («تحدي الوقت», «سين جيم») on every page. */
'use strict';

const TEAM_ORDER = ['red', 'blue'];
const TEAM_INFO = {
  red: { name: 'الأحمر', emoji: '🔴' },
  blue: { name: 'الأزرق', emoji: '🔵' },
};
const otherTeam = (team) => (team === 'red' ? 'blue' : 'red');

/** Names the host gave the teams (a game's settings.teamNames); the page sets them on every render. */
let teamNames = {};
function useTeamNames(names) {
  teamNames = names ?? {};
}
/** «🔴 الفريق الأحمر», or «🔴 الشباب» when the host named the team. */
const teamLabel = (team) => (teamNames[team]
  ? `${TEAM_INFO[team].emoji} ${teamNames[team]}`
  : `${TEAM_INFO[team].emoji} الفريق ${TEAM_INFO[team].name}`);
const teamShort = (team) => `${TEAM_INFO[team].emoji} ${teamNames[team] || TEAM_INFO[team].name}`;
