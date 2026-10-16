/* Shared by the team games («تحدي الوقت», «سين جيم») on every page. */
'use strict';

const TEAM_ORDER = ['red', 'blue'];
const TEAM_INFO = {
  red: { name: 'الأحمر', emoji: '🔴' },
  blue: { name: 'الأزرق', emoji: '🔵' },
};
const otherTeam = (team) => (team === 'red' ? 'blue' : 'red');
const teamLabel = (team) => `${TEAM_INFO[team].emoji} الفريق ${TEAM_INFO[team].name}`;
const teamShort = (team) => `${TEAM_INFO[team].emoji} ${TEAM_INFO[team].name}`;
