/* global h, TEAM_ORDER, otherTeam, teamShort */
'use strict';

// Pieces of «سين جيم» shared by the host and player pages.

const SJ_LIFELINES = {
  pit: { emoji: '🕳️', name: 'الحفرة', hint: 'لو جاوبتوا صح، تنخصم نفس النقاط من الفريق الثاني' },
  double: { emoji: '2️⃣', name: 'دبل نقاط', hint: 'لو جاوبتوا صح، تاخذون النقاط ضعف' },
  two: { emoji: '✌️', name: 'جاوب جوابين', hint: 'تقولون جوابين، ولو واحد منهم صح تاخذون النقاط' },
  call: { emoji: '📞', name: 'اتصال بصديق', hint: 'تتصلون على أحد برا الغرفة، معكم 30 ثانية' },
};
const SJ_ORDER = ['pit', 'double', 'two', 'call'];

/** The team that answers right now: the team on turn, or the other team stealing. */
function sjAnswering(s) {
  if (!s.current) return s.turn;
  return s.phase === 'steal' ? otherTeam(s.current.team) : s.current.team;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** Both teams' points and helps; compact is a single line, for screens with a question on them. */
function sjScoreboard(s, { myTeam = null, compact = false } = {}) {
  const active = ['board', 'picked', 'question', 'steal'].includes(s.phase) ? sjAnswering(s) : null;
  return h('div', { class: `sj-score${compact ? ' compact' : ''}` }, TEAM_ORDER.map((team) => h('div', {
    class: `sj-score-team ${team}${active === team ? ' active' : ''}${myTeam === team ? ' mine' : ''}`,
  },
    h('div', { class: 'sj-score-name' }, teamShort(team), myTeam === team ? h('small', {}, ' · فريقك') : null),
    h('div', { class: 'sj-score-points', dir: 'ltr', 'data-bump': `score-${team}` }, s.score[team]),
    h('div', { class: 'sj-lifelines', 'aria-label': 'وسائل المساعدة' }, SJ_ORDER.map((name) => {
      const left = s.lifelines[team].includes(name);
      return h('span', {
        class: `sj-life${left ? '' : ' used'}`,
        title: `${SJ_LIFELINES[name].name}${left ? '' : ' (انستخدمت)'}`,
      }, SJ_LIFELINES[name].emoji);
    })),
  )));
}

/** The six categories and their 200 / 400 / 600 tiles; onPick makes open tiles clickable. */
function sjBoard(s, { onPick = null } = {}) {
  return h('div', { class: 'sj-board' }, s.board.map((column) => h('div', { class: 'sj-col' },
    h('div', { class: 'sj-cat' }, h('span', { class: 'sj-cat-emoji' }, column.category.emoji), h('span', {}, column.category.name)),
    column.tiles.map((tile) => {
      const played = Boolean(tile.wonBy);
      return h(onPick && !played ? 'button' : 'div', {
        type: onPick && !played ? 'button' : null,
        class: `sj-tile${played ? ` played won-${tile.wonBy}` : ''}`,
        'data-tile': tile.id,
        onclick: onPick && !played ? () => onPick(tile) : null,
      }, tile.value);
    }),
  )));
}

function sjQuestion(current) {
  if (!current?.question) return null;
  const { q, img } = current.question;
  return h('div', { class: `sj-question${img ? ' with-img' : ''}` },
    img ? h('div', { class: 'sj-img' }, h('img', { src: img, alt: '' })) : null,
    h('div', { class: 'sj-q', dir: 'auto' }, q),
  );
}

function sjHead(current) {
  return h('div', { class: 'sj-head' },
    h('span', { class: 'sj-head-cat' }, `${current.category.emoji} ${current.category.name}`),
    h('span', { class: 'sj-head-value' }, current.value),
    [...current.before, ...current.during].map((name) => h('span', { class: 'sj-badge', title: SJ_LIFELINES[name].hint },
      `${SJ_LIFELINES[name].emoji} ${SJ_LIFELINES[name].name}`)),
  );
}

/** What happened on the question, in a line or two. */
function sjResult(current) {
  const r = current.result;
  if (!r) return null;
  if (!r.winner) return h('div', { class: 'sj-result none' }, 'محد جاوب 🤷');
  return h('div', { class: `sj-result ${r.winner}` },
    h('div', {}, `${teamShort(r.winner)} `, h('b', { dir: 'ltr' }, signed(r.gain))),
    r.pit ? h('div', { class: 'sj-result-pit' }, `🕳️ الحفرة: ${teamShort(otherTeam(r.winner))} `, h('b', { dir: 'ltr' }, signed(-r.pit))) : null,
  );
}

function sjWinnerText(s) {
  if (!s.winner) return 'تعادل! 🤝';
  return `${teamShort(s.winner)} فاز! 🏆`;
}

function sjRulesList(settings) {
  return h('ul', { class: 'rules-list' },
    h('li', {}, `فريقين: ${teamShort('red')} و${teamShort('blue')}، ولوحة فيها 6 فئات، وكل فئة فيها أسئلة بـ200 و400 و600.`),
    settings.phones === false ? h('li', {}, 'نلعب بدون جوالات: كل فريق يجلس سوا، ويقول جوابه بصوت عالي للمضيف.') : null,
    h('li', {}, 'الفرق تتناوب: الفريق اللي عليه الدور يختار سؤال، ويجاوب قبل ما يخلص وقته '
      + `(${settings.turnSeconds} ثانية).`),
    h('li', {}, `لو غلط أو خلص وقته، الفريق الثاني ياخذ فرصة يسرق النقاط (${settings.stealSeconds} ثانية).`),
    h('li', {}, 'المضيف هو الحكم، والجواب يطلع عنده بس لين ينتهي السؤال.'),
    h('li', {}, 'كل فريق عنده 4 وسائل مساعدة، كل وحدة مرة:'),
    h('ul', {}, SJ_ORDER.map((name) => h('li', {}, `${SJ_LIFELINES[name].emoji} ${SJ_LIFELINES[name].name}: ${SJ_LIFELINES[name].hint}`
      + (name === 'pit' || name === 'double' ? ' (تختارونها قبل ما يطلع السؤال)' : ' (بعد ما يطلع السؤال)')))),
    h('li', {}, 'بعد آخر سؤال، الفريق اللي نقاطه أكثر يفوز.'),
  );
}
