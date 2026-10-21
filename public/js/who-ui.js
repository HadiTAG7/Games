/* global h, icon, pointsText */
'use strict';

// Pieces of «مين فينا؟» shared by the host and player pages.

function whoRulesList(s, rules) {
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'يطلع سؤال عن الشلة، مثل: «مين أكثر واحد يتأخر على المواعيد؟».'),
    h('li', {}, 'كل واحد يصوّت بالسر من جواله لواحد من الموجودين (حتى نفسه)، ويقدر يغيّر صوته لين ينكشف.'),
    h('li', {}, 'لما الكل يصوّت أو يخلص الوقت، تنكشف الأصوات: كم صوت جاب كل واحد بس، ومحد يعرف مين صوّت لمين.'),
    h('li', {}, `اللي صوّت لصاحب أكثر الأصوات ياخذ ${pointsText(rules.point)}، ولو تعادلوا ياخذ كل اللي صوّتوا لأي واحد منهم.`),
    h('li', {}, `ولو محد جاب ${rules.majorityFrom === 2 ? 'صوتين' : `${rules.majorityFrom} أصوات`} أو أكثر، ما فيه أغلبية ومحد ياخذ.`),
    h('li', {}, `بعد ${s.source === 'custom' ? 'آخر سؤال' : `${s.rounds} أسئلة`}، صاحب أعلى نقاط يفوز، وكل سؤال يصير لقب لصاحب أكثر الأصوات فيه.`),
  );
}

function whoRoundTitle(round) {
  return `السؤال ${round.number} من ${round.total}`;
}

/** «مين أكثر واحد يتأخر على المواعيد؟» → «أكثر واحد يتأخر على المواعيد». */
function whoTitle(question) {
  return question.replace(/[؟?]\s*$/, '').replace(/^مين\s+(?:(?:فينا|تتوقعون|بيكون)\s+)?/, '');
}

/** Votes per player, most first, the top ones crowned. */
function whoTally(result) {
  const max = Math.max(1, ...result.tally.map((t) => t.votes));
  const top = new Set(result.top);
  return h('ol', { class: 'os-tally who-tally' }, result.tally.map((t) => h('li', { class: top.has(t.name) ? 'top' : null },
    h('span', { class: 'os-tally-name' }, top.has(t.name) ? [icon('crown'), ' '] : '', t.name),
    h('span', { class: 'os-tally-bar' }, h('span', { style: `width:${(t.votes / max) * 100}%` })),
    h('b', {}, t.votes),
  )));
}

/** «الشلة اختارت: سلطان», or that nobody got a majority. */
function whoVerdict(result) {
  if (!result.top.length) return h('div', { class: 'who-verdict none' }, h('b', {}, 'ما فيه أغلبية هالمرة'), h('small', {}, 'الأصوات توزعت'));
  return h('div', { class: 'who-verdict' },
    h('small', {}, result.top.length > 1 ? 'تعادلوا بـ' : 'الشلة اختارت', result.top.length > 1 ? ` ${result.most} أصوات` : ''),
    h('b', {}, icon('crown'), ' ', result.top.join(' و')),
  );
}

/** Each question's top name: «سلطان · أكثر واحد يتأخر على المواعيد». */
function whoTitles(titles, { meName = null } = {}) {
  if (!titles.length) return null;
  return h('ul', { class: 'who-titles' }, titles.map((t) => h('li', { class: meName && t.names.includes(meName) ? 'me' : null },
    h('b', {}, t.names.join(' و')),
    h('span', {}, whoTitle(t.question)),
  )));
}
