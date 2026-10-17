/* global h */
'use strict';

// Pieces of «مافيا» shared by the host and player pages.

const MF_ROLES = {
  mafia: { emoji: '🔪', name: 'مافيا', goal: 'كل ليلة تأشرون على ضحية وربعكم يشوفون إشارتكم، ولما تتفقون كلكم تعتمدونها. لو ما اتفقتوا محد يموت. تفوزون لما يصير عددكم يساوي الباقين.' },
  doctor: { emoji: '🩺', name: 'دكتور', goal: 'كل ليلة تختار واحد تنقذه، وتقدر تنقذ نفسك. بس ما تنقذ نفس الشخص ليلتين ورا بعض.' },
  police: { emoji: '👮', name: 'شرطي', goal: 'كل ليلة تسأل عن واحد، وجوالك يقول لك بالسر إذا هو مافيا أو لا.' },
  sniper: { emoji: '🎯', name: 'قنّاص', goal: 'عندك طلقة وحدة طول اللعبة. تطلقها بالليل على أي أحد، أو تخليها لليلة ثانية.' },
  mayor: { emoji: '🎩', name: 'العمدة', goal: 'مواطن والكل يعرفك. صوتك في التصويت يحسب بصوتين.' },
  jester: { emoji: '🃏', name: 'الانتحاري', goal: 'هدفك يصوّتون عليك ويطلعونك! خلّ الكل يشك فيك بدون ما يبان إنك تبيها. لو طلعت بالتصويت تفوز لحالك، ولو متّ بالليل أو خلصت اللعبة وأنت موجود تخسر.' },
  citizen: { emoji: '👤', name: 'مواطن', goal: 'ما عندك شي بالليل. ركّز بالنقاش واكشف المافيا بالتصويت.' },
};
const MF_ROLE_ORDER = ['mafia', 'doctor', 'police', 'sniper', 'mayor', 'jester', 'citizen'];

const mfRole = (role) => `${MF_ROLES[role].emoji} ${MF_ROLES[role].name}`;

/** «🔪 مافيا ×2 · 🩺 دكتور · 👤 مواطن ×3» */
function mfLineup(lineup) {
  return h('ul', { class: 'chips mf-lineup' }, MF_ROLE_ORDER.filter((r) => lineup[r]).map((r) => h('li', { class: `chip mf-chip ${r}` },
    mfRole(r), lineup[r] > 1 ? h('b', {}, ` ×${lineup[r]}`) : null)));
}

function mfRulesList(lineup) {
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'كل واحد يشوف دوره بالسر في جواله. المافيا يعرفون بعض، والعمدة يعرفه الكل.'),
    h('li', {}, 'بالليل كل واحد يختار شخص من جواله، عشان محد يعرف مين عنده دور من شكل جواله.'),
    MF_ROLE_ORDER.filter((r) => lineup[r]).map((r) => h('li', {}, h('b', {}, `${mfRole(r)}: `), MF_ROLES[r].goal)),
    h('li', {}, 'الصبح الشاشة تعلن مين مات. بعدها تتناقشون وتصوّتون من الجوالات، واللي ياخذ أصوات أكثر يطلع. ولو فيه تعادل محد يطلع.'),
    h('li', {}, 'المواطنين يفوزون لو طلّعوا كل المافيا، والمافيا يفوزون لو صار عددهم يساوي الباقين.'),
    lineup.jester ? h('li', {}, 'وانتبهوا من الانتحاري 🃏: لو طلّعتوه بالتصويت يفوز لحاله وتخلص اللعبة.') : null,
  );
}

/** Everyone in the game: alive or out, with the roles this screen may see. */
function mfPlayers(players, { meId = null } = {}) {
  return h('ul', { class: 'chips mf-players' }, players.filter((p) => p.inGame).map((p) => h('li', {
    class: `chip${p.alive ? '' : ' dead'}${p.id === meId ? ' me' : ''}${p.connected ? '' : ' away'}`,
  }, p.alive ? '' : '💀 ', p.name, p.role ? h('small', { class: `mf-badge ${p.role}` }, ` ${mfRole(p.role)}`) : null)));
}

const mfWho = (p) => (p.role ? `${p.name} (${mfRole(p.role)})` : p.name);

/** What happened in the night, or in the vote. */
function mfAnnouncement(a) {
  if (!a) return null;
  if (a.kind === 'morning') {
    const lines = [];
    if (a.shot) lines.push(h('p', { class: 'mf-shot' }, '🎯 انسمع صوت طلقة بالليل!'));
    if (a.deaths.length) {
      lines.push(...a.deaths.map((p) => h('div', { class: 'mf-death' }, '💀 ', h('b', {}, p.name), ' مات',
        p.role ? h('span', {}, ` · كان ${mfRole(p.role)}`) : null)));
    } else {
      lines.push(h('div', { class: 'mf-safe' }, a.saved ? '🩺 الدكتور أنقذ أحد، محد مات الليلة!' : '😮‍💨 محد مات الليلة'));
    }
    return h('div', { class: 'mf-announce' }, lines);
  }
  const tally = h('ol', { class: 'mf-tally' }, a.tally.map((t) => h('li', {},
    h('span', {}, t.target === 'none' ? '🙅 ما نطلّع أحد' : t.target.name), h('b', {}, t.votes))));
  return h('div', { class: 'mf-announce' },
    a.out
      ? h('div', { class: 'mf-death' }, '🗳️ طلع ', h('b', {}, a.out.name), ' بالتصويت', a.out.role ? h('span', {}, ` · كان ${mfRole(a.out.role)}`) : null)
      : h('div', { class: 'mf-safe' }, '🤝 محد طلع هالمرة'),
    a.tally.length ? tally : null,
  );
}

function mfWinnerText(winner) {
  if (winner === 'jester') return 'الانتحاري فاز! 🃏 انخدعتوا فيه';
  return winner === 'mafia' ? 'المافيا فازوا! 🔪' : 'المواطنين فازوا! 🎉';
}

/** Did this role win? The jester is on nobody's side (same rule as the server's wonWith). */
function mfWon(role, winner) {
  if (!role || !winner) return false;
  if (role === 'jester' || winner === 'jester') return role === winner;
  return (role === 'mafia') === (winner === 'mafia');
}
