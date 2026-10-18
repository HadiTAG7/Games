/* global h, TEAM_ORDER, teamShort, teamLabel */
'use strict';

// Pieces of «فاميلي فيود» shared by the host and player pages: the board of
// answers, the strikes, the scores and the rules.

/** «الجولة 2 من 4» and the double-points badge. */
function ffRoundTitle(s) {
  return h('div', { class: 'ff-round-title' },
    h('span', {}, `الجولة ${s.roundNumber} من ${s.rounds}`),
    s.round?.multiplier > 1 ? h('b', { class: 'ff-double' }, `النقاط ×${s.round.multiplier}`) : null);
}

function ffScore(s, { myTeam = null } = {}) {
  return h('div', { class: 'ff-score' }, TEAM_ORDER.map((team) => h('div', {
    class: `ff-score-team ${team}${s.round?.playing === team && ['play', 'steal'].includes(s.phase) ? ' active' : ''}`,
  }, h('span', {}, teamShort(team), myTeam === team ? h('small', {}, ' · فريقك') : null), h('b', { 'data-bump': `score-${team}` }, s.score[team]))));
}

/** Where the question's points come from: an estimate, or real answers. */
function ffSource(round) {
  return round.source === 'survey'
    ? h('span', { class: 'ff-source survey' }, `📊 من أجوبتكم الحقيقية: ${round.responses} جواب`)
    : h('span', { class: 'ff-source' }, '📝 النقاط تقديرية');
}

/**
 * The board: a slot per answer, best first. Closed slots show their number,
 * or (peek) the answer faintly for the host. onSlot makes them buttons.
 */
function ffBoard(round, { peek = false, onSlot = null } = {}) {
  const half = Math.ceil(round.slots.length / 2);
  // Once the round is over the answers nobody said show for everyone, dimmer.
  const late = Boolean(round.result);
  const slot = (s) => {
    const shown = s.open || ((peek || late) && s.a);
    const body = [
      h('span', { class: 'ff-slot-num' }, s.index + 1),
      shown ? h('span', { class: 'ff-slot-answer' }, s.a) : null,
      shown ? h('b', { class: 'ff-slot-points' }, s.points) : null,
    ];
    const cls = `ff-slot${s.open ? ' open' : ''}${!s.open && late && s.a ? ' late' : !s.open && peek && s.a ? ' peek' : ''}`;
    return onSlot && !s.open
      ? h('button', { type: 'button', class: cls, 'data-slot': s.index, onclick: () => onSlot(s.index), title: 'اضغط لما يقولون هالجواب' }, ...body)
      : h('div', { class: cls, 'data-slot': s.index }, ...body);
  };
  return h('div', { class: 'ff-board' },
    h('div', { class: 'ff-col' }, round.slots.slice(0, half).map(slot)),
    h('div', { class: 'ff-col' }, round.slots.slice(half).map(slot)));
}

function ffStrikes(n) {
  return h('div', { class: 'ff-strikes', 'aria-label': `${n} غلط` }, [0, 1, 2].map((i) => h('span', { class: `ff-x${i < n ? ' on' : ''}` }, '✕')));
}

function ffPot(round) {
  return h('div', { class: 'ff-pot' }, h('small', {}, 'نقاط الجولة'), h('b', { 'data-bump': 'ff-pot' }, round.pot));
}

/** «🔴 الشباب أخذ 120 نقطة» and why. */
function ffResultText(result) {
  const why = { cleared: 'فتحوا كل الأجوبة 🎉', steal: 'سرقوا النقاط! 🦊', held: 'فرصة السرقة راحت، والنقاط لهم' }[result.reason];
  return { title: `${teamLabel(result.winner)} أخذ ${result.points} نقطة`, detail: why };
}

function ffWinnerText(winner) {
  return winner ? `${teamShort(winner)} فاز! 🏆` : 'تعادل! 🤝';
}

function ffRulesList(settings) {
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'فريقين، وكل سؤال له أشهر الأجوبة مرتبة من الأكثر، وكل جواب له نقاط حسب كم واحد قاله.'),
    h('li', {}, 'كل جولة تبدأ بمواجهة: واحد من كل فريق، وأول واحد يضغط البازر يجاوب. الجواب الأعلى ترتيب ياخذ الدور لفريقه، وفريقه يقرر: يلعبون ولا يمررون.'),
    h('li', {}, 'الفريق اللي عليه الدور يقول أجوبة، والمضيف يفتحها. 3 أجوبة غلط ❌❌❌ والفريق الثاني ياخذ فرصة يسرق كل نقاط الجولة بجواب واحد.'),
    h('li', {}, `${settings.rounds} جولات، وآخر جولة نقاطها ×2. والفريق اللي نقاطه أكثر يفوز.`),
    settings.fastMoney ? h('li', {}, '⚡ المال السريع بالنهاية: اثنين من الفريق الفايز يجاوبون 5 أسئلة بسرعة (20 و25 ثانية)، ولو جمعوا 200 نقطة يفوزون.') : null,
    settings.phones === false ? h('li', {}, 'نلعب بدون جوالات: المضيف يحدد مين ضغط أول، وكل فريق يجاوب بصوت عالي.') : null,
    h('li', {}, 'نقاط أسئلة الموقع تقديرية، وفيه أسئلة نقاطها من أجوبة لاعبين حقيقيين في «عقلية القطيع» (📊).'),
  );
}

/** «المال السريع»: the five questions with both players' answers and points. */
function ffFastTable(fast, { onMark = null } = {}) {
  return h('table', { class: 'ff-fast-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'السؤال'),
      ...[0, 1].map((s) => h('th', {}, fast.players[s]?.name ?? (s ? 'اللاعب الثاني' : 'اللاعب الأول'))))),
    h('tbody', {}, fast.questions.map((q, i) => h('tr', {},
      h('td', { class: 'ff-fast-q' }, q.q),
      ...[0, 1].map((s) => {
        const cell = fast.stages[s][i];
        if (!cell) return h('td', { class: 'ff-fast-cell hidden' }, '•••');
        const pick = onMark && q.answers && s === fast.stage
          ? h('select', {
            class: 'ff-fast-mark',
            'aria-label': 'الجواب المطابق',
            onchange: (e) => onMark(s, i, e.target.value === '' ? null : Number(e.target.value)),
          }, h('option', { value: '', selected: cell.slot === null }, '— ما فيه —'),
          q.answers.map((a, j) => h('option', { value: j, selected: cell.slot === j }, `${a.a} (${a.points})`)))
          : null;
        return h('td', { class: `ff-fast-cell${cell.slot === null ? ' zero' : ''}` },
          h('span', { class: 'ff-fast-typed' }, cell.text || '—'),
          cell.a && cell.a !== cell.text ? h('small', {}, `= ${cell.a}`) : null,
          h('b', {}, cell.points), pick);
      })))));
}
