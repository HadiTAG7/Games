/* Shared by the team games («تحدي الوقت», «سين جيم») on every page. */
'use strict';

const TEAM_ORDER = ['red', 'blue'];
const TEAM_INFO = {
  red: { name: 'الأحمر' },
  blue: { name: 'الأزرق' },
};
const otherTeam = (team) => (team === 'red' ? 'blue' : 'red');

/** Names the host gave the teams (a game's settings.teamNames); the page sets them on every render. */
let teamNames = {};
function useTeamNames(names) {
  teamNames = names ?? {};
}
/** «الفريق الأحمر», or «الشباب» when the host named the team. */
const teamLabel = (team) => (teamNames[team] || `الفريق ${TEAM_INFO[team].name}`);
const teamShort = (team) => teamNames[team] || TEAM_INFO[team].name;
/** The team's colour as a dot, to put before its name. */
const teamDot = (team) => h('span', { class: `team-dot ${team}`, 'aria-hidden': 'true' });
