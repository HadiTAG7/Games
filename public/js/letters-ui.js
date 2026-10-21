/* global h, teamLabel, teamShort */
'use strict';

// Pieces of «حروف» shared by the host and player pages: the hexagon board.

const HR_SIZE = 5;

/**
 * The 5 × 5 board of hexagons. Odd rows sit half a cell to the right.
 * 🔴 owns the left and right edges, 🔵 the top and bottom.
 */
function hrBoard(s, { onPick = null, current = null } = {}) {
  const path = new Set(s.result?.path ?? []);
  return h('div', { class: 'hr-frame' },
    h('div', { class: 'hr-board' }, s.board.map((cell, i) => {
      const r = Math.floor(i / HR_SIZE);
      const c = i % HR_SIZE;
      const clickable = onPick && !cell.owner;
      return h(clickable ? 'button' : 'div', {
        type: clickable ? 'button' : null,
        class: `hr-cell${cell.owner ? ` ${cell.owner}` : ''}${current === i ? ' current' : ''}${path.has(i) ? ' path' : ''}`,
        style: `left:${((c + (r % 2) * 0.5) / (HR_SIZE + 0.5)) * 100}%;top:${r * 18.75}%`,
        'aria-label': cell.owner ? `${cell.letter} (${teamShort(cell.owner)})` : cell.letter,
        onclick: clickable ? () => onPick(i) : null,
      }, h('span', {}, cell.letter));
    })),
  );
}

function hrSides() {
  return h('p', { class: 'hr-sides' },
    h('span', { class: 'red' }, h('span', { class: 'team-dot red', 'aria-hidden': 'true' }), ' يوصّل يمين ↔ يسار'), ' · ', h('span', { class: 'blue' }, h('span', { class: 'team-dot blue', 'aria-hidden': 'true' }), ' يوصّل فوق ↕ تحت'));
}

/** A big hexagon with the letter being played. */
function hrLetter(letter) {
  return h('div', { class: 'hr-big-letter' }, h('span', {}, letter));
}

function hrBuzzStatus(current) {
  if (current.buzz) return null;
  if (current.locked.length === 0) return 'البازر مفتوح للفريقين';
  const open = current.locked.includes('red') ? 'blue' : 'red';
  return `${teamShort(current.locked[0])} غلط، البازر مفتوح لـ${teamShort(open)} بس`;
}

function hrRulesList(settings) {
  const rounds = settings.roundsToWin;
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'فريقين ولوحة فيها 25 حرف على شكل خلايا.'),
    h('li', {}, h('span', { class: 'team-dot red', 'aria-hidden': 'true' }), ' الأحمر يحاول يوصّل خلاياه من اليمين لليسار، و', h('span', { class: 'team-dot blue', 'aria-hidden': 'true' }), ' الأزرق من فوق لتحت.'),
    h('li', {}, 'الفريق اللي عليه الدور يختار حرف، ويطلع سؤال جوابه يبدأ بهالحرف.'),
    h('li', {}, 'اللي يعرف الجواب يضغط البازر في جواله، وأول واحد يضغط يجاوب.'),
    h('li', {}, 'لو جوابه صح تصير الخلية لفريقه، وفريقه يختار الحرف الجاي. ولو غلط، الفرصة للفريق الثاني.'),
    h('li', {}, 'كل فريق يقدر يسد طريق الثاني بالخلايا اللي ياخذها.'),
    h('li', {}, `أول فريق يوصّل طريقه يكسب الجولة، واللي يكسب ${rounds === 1 ? 'جولة وحدة' : rounds === 2 ? 'جولتين' : `${rounds} جولات`} يفوز باللعبة.`),
  );
}

function hrRoundTitle(result) {
  return `${teamLabel(result.winner)} وصّل طريقه وكسب الجولة!`;
}
