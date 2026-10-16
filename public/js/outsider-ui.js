/* global h */
'use strict';

// Pieces of «برا السالفة» shared by the host and player pages.

function osRulesList(s, rules) {
  const two = s.outsiders === 2;
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'كل جولة تطلع كلمة سرية (السالفة) في جوال الكل، إلا واحد يطلع له «أنت برا السالفة 🤫» ويشوف الفئة بس.'),
    two ? h('li', {}, `لو كنتم ${rules.twoOutsidersFrom} أو أكثر، يكونون اثنين برا السالفة.`) : null,
    h('li', {}, 'كل واحد يسأل اللي بعده سؤال عن السالفة، بدون ما يفضحها. واللي برا السالفة يحاول يجاري ويفهم وش هي.'),
    s.freeSeconds ? h('li', {}, `بعدها ${s.freeSeconds} ثانية أسئلة حرة لأي أحد.`) : null,
    h('li', {}, 'تصوّتون من جوالاتكم: مين برا السالفة؟'),
    h('li', {}, `كل واحد صوّت صح ياخذ ${rules.points.vote === 1 ? 'نقطة' : `${rules.points.vote} نقاط`}. واللي برا السالفة ياخذ ${rules.points.escape} نقاط لو ما انكشف.`),
    h('li', {}, `وفي الآخر اللي برا السالفة يخمّن السالفة من ${8} خيارات، ولو جابها ياخذ نقطتين زيادة.`),
    h('li', {}, `بعد ${s.rounds} جولات، صاحب أعلى نقاط يفوز.`),
  );
}

function osCategory(round) {
  return h('div', { class: 'os-category' }, h('span', {}, round.category.emoji), h('b', {}, round.category.name));
}

/** Votes per player, most first, with the outsiders marked. */
function osTally(round) {
  const max = Math.max(1, ...round.tally.map((t) => t.votes));
  const outs = new Set(round.outsiders.map((o) => o.id));
  return h('ol', { class: 'os-tally' }, round.tally.map((t) => h('li', { class: outs.has(t.id) ? 'outsider' : null },
    h('span', { class: 'os-tally-name' }, t.name, outs.has(t.id) ? ' 🤫' : ''),
    h('span', { class: 'os-tally-bar' }, h('span', { style: `width:${(t.votes / max) * 100}%` })),
    h('b', {}, t.votes),
  )));
}

/** «برا السالفة كان: فهد», caught or not. */
function osOutsiderBanner(round) {
  const names = round.outsiders.map((o) => o.name).join(' و');
  const caught = round.outsiders.filter((o) => o.caught);
  let verdict = 'ما انكشف! 😎';
  if (caught.length === round.outsiders.length) verdict = round.outsiders.length > 1 ? 'انكشفوا! 🎯' : 'انكشف! 🎯';
  else if (caught.length) verdict = `انكشف ${caught.map((o) => o.name).join(' و')} بس`;
  return h('div', { class: `os-outsider ${caught.length ? 'caught' : 'escaped'}` },
    h('small', {}, round.outsiders.length > 1 ? 'اللي برا السالفة كانوا' : 'اللي برا السالفة كان'),
    h('b', {}, `${names} 🤫`),
    h('span', {}, verdict),
  );
}

/** What each player earned this round. */
function osGains(round) {
  const rows = Object.entries(round.gains ?? {}).map(([id, n]) => ({ id, n, name: round.players.find((p) => p.id === id)?.name }));
  if (!rows.length) return h('p', { class: 'hint center' }, 'محد كسب نقاط هالجولة');
  return h('ul', { class: 'chips os-gains' }, rows.map((r) => h('li', { class: 'chip' }, r.name, h('b', {}, ` +${r.n}`))));
}

function osRoundTitle(s) {
  return `الجولة ${s.roundNumber} من ${s.totalRounds}`;
}
