/* global h, icon, serverNow, sfx */
'use strict';

// Pieces of «مافيا» shared by the host and player pages.

const MF_ROLES = {
  mafia: { icon: 'swords', name: 'مافيا', goal: 'كل ليلة تأشرون على ضحية وربعكم يشوفون إشارتكم، ولما تتفقون كلكم تعتمدونها. لو ما اتفقتوا محد يموت. تفوزون لما يصير عددكم يساوي الباقين.' },
  doctor: { icon: 'stethoscope', name: 'دكتور', goal: 'كل ليلة تختار واحد تنقذه، وتقدر تنقذ نفسك. بس ما تنقذ نفس الشخص ليلتين ورا بعض.' },
  police: { icon: 'shield', name: 'شرطي', goal: 'كل ليلة تسأل عن واحد، وجوالك يقول لك بالسر إذا هو مافيا أو لا.' },
  sniper: { icon: 'crosshair', name: 'قنّاص', goal: 'عندك طلقة وحدة طول اللعبة. تطلقها بالليل على أي أحد، أو تخليها لليلة ثانية.' },
  mayor: { icon: 'award', name: 'العمدة', goal: 'مواطن والكل يعرفك. صوتك في التصويت يحسب بصوتين.' },
  jester: { icon: 'laugh', name: 'الانتحاري', goal: 'هدفك يصوّتون عليك ويطلعونك! خلّ الكل يشك فيك بدون ما يبان إنك تبيها. لو طلعت بالتصويت تفوز لحالك، ولو متّ بالليل أو خلصت اللعبة وأنت موجود تخسر.' },
  citizen: { icon: 'user', name: 'مواطن', goal: 'ما عندك شي بالليل. ركّز بالنقاش واكشف المافيا بالتصويت.' },
};
const MF_ROLE_ORDER = ['mafia', 'doctor', 'police', 'sniper', 'mayor', 'jester', 'citizen'];

const mfRole = (role) => MF_ROLES[role].name;
/** A role with its icon, for the page. */
const mfRoleTag = (role) => [icon(MF_ROLES[role].icon), MF_ROLES[role].name];

/** «🔪 مافيا ×2 · 🩺 دكتور · 👤 مواطن ×3» */
function mfLineup(lineup) {
  return h('ul', { class: 'chips mf-lineup' }, MF_ROLE_ORDER.filter((r) => lineup[r]).map((r) => h('li', { class: `chip mf-chip ${r}` },
    mfRoleTag(r), lineup[r] > 1 ? h('b', {}, ` ×${lineup[r]}`) : null)));
}

function mfRulesList(lineup) {
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'كل واحد يشوف دوره بالسر في جواله. المافيا يعرفون بعض، والعمدة يعرفه الكل.'),
    h('li', {}, 'بالليل كل واحد يختار شخص من جواله، عشان محد يعرف مين عنده دور من شكل جواله.'),
    MF_ROLE_ORDER.filter((r) => lineup[r]).map((r) => h('li', {}, h('b', {}, `${mfRole(r)}: `), MF_ROLES[r].goal)),
    h('li', {}, 'الصبح الشاشة تعلن مين مات. بعدها تتناقشون وتصوّتون من الجوالات، واللي ياخذ أصوات أكثر يطلع. ولو فيه تعادل محد يطلع.'),
    h('li', {}, 'المواطنين يفوزون لو طلّعوا كل المافيا، والمافيا يفوزون لو صار عددهم يساوي الباقين.'),
    lineup.jester ? h('li', {}, 'وانتبهوا من الانتحاري ', icon('laugh'), ': لو طلّعتوه بالتصويت يفوز لحاله وتخلص اللعبة.') : null,
  );
}

/** Everyone in the game: alive or out, with the roles this screen may see. */
function mfPlayers(players, { meId = null } = {}) {
  return h('ul', { class: 'chips mf-players' }, players.filter((p) => p.inGame).map((p) => h('li', {
    class: `chip${p.alive ? '' : ' dead'}${p.id === meId ? ' me' : ''}${p.connected ? '' : ' away'}`,
  }, p.alive ? '' : [icon('skull'), ' '], p.name, p.role ? h('small', { class: `mf-badge ${p.role}` }, ` ${mfRole(p.role)}`) : null)));
}

const mfWho = (p) => (p.role ? `${p.name} (${mfRole(p.role)})` : p.name);

/** What happened in the night, or in the vote. */
/** The outcome in short, under the story. `tally: false` leaves out the votes (the story counted them). */
function mfAnnouncement(a, { tally: withTally = true } = {}) {
  if (!a) return null;
  if (a.kind === 'morning') {
    const lines = [];
    if (a.shot) lines.push(h('p', { class: 'mf-shot' }, icon('crosshair'), ' انسمع صوت طلقة بالليل!'));
    if (a.deaths.length) {
      lines.push(...a.deaths.map((p) => h('div', { class: 'mf-death' }, icon('skull'), ' ', h('b', {}, p.name), ' مات',
        p.role ? h('span', {}, ` · كان ${mfRole(p.role)}`) : null)));
    } else {
      lines.push(h('div', { class: 'mf-safe' }, a.saved ? [icon('stethoscope'), ' محد مات الليلة، والفضل للدكتور!'] : 'محد مات الليلة'));
    }
    return h('div', { class: 'mf-announce' }, lines);
  }
  const tally = h('ol', { class: 'mf-tally' }, a.tally.map((t) => h('li', {},
    h('span', {}, t.target === 'none' ? [icon('ban'), ' ما نطلّع أحد'] : t.target.name), h('b', {}, t.votes))));
  return h('div', { class: 'mf-announce' },
    a.out
      ? h('div', { class: 'mf-death' }, icon('vote'), ' طلع ', h('b', {}, a.out.name), ' بالتصويت', a.out.role ? h('span', {}, ` · كان ${mfRole(a.out.role)}`) : null)
      : h('div', { class: 'mf-safe' }, icon('handshake'), ' محد طلع هالمرة'),
    withTally && a.tally.length ? tally : null,
  );
}

/* ---------- The narrator ---------- */

/** One line of the story: «{name}» in bold, «{role}» by name; a tally line has a bar. */
function mfBeatText(beat) {
  if (beat.kind === 'tally') {
    return [
      h('b', { class: 'mf-name' }, beat.none ? 'ما نطلّع أحد' : beat.name),
      h('span', { class: 'mf-beat-bar' }, h('span', { style: `--fill:${beat.votes / beat.max}` })),
      h('b', { class: 'mf-beat-votes' }, beat.votes),
    ];
  }
  const text = beat.text.replace('{role}', beat.role ? mfRole(beat.role) : '…');
  return text.split('{name}').flatMap((part, i) => (i ? [h('b', { class: 'mf-name' }, beat.name), part] : [part]));
}

function mfBeat(beat, enter) {
  return h('div', { class: `mf-beat ${beat.kind} ${beat.tone}${enter ? ' enter' : ''}` },
    h('span', { class: 'mf-beat-icon' }, icon(beat.icon)),
    h('p', {}, mfBeatText(beat)),
    beat.kind === 'reveal' && beat.role ? h('small', { class: 'mf-beat-role' }, `كان ${mfRole(beat.role)}`) : null,
  );
}

/**
 * The night's (or the vote's) story, told line by line at the moments the
 * server set, so the TV and every phone tell it together; a page opened
 * midway shows what's been told and goes on from there. With `sound` (the
 * TV), each new line plays its sound. A redraw stops the old copy's timers.
 */
function mfStory(story, { sound = false } = {}) {
  const length = story.endsAt - story.startedAt;
  const elapsed = story.told ? length : Math.min(length, Math.max(0, serverNow() - story.startedAt));
  const box = h('section', {
    class: `mf-story ${story.kind}${story.told ? ' told' : ''}`,
    style: `--story-length:${length}ms; --story-elapsed:${-elapsed}ms`,
    'aria-live': 'polite',
  });
  for (const beat of story.beats) {
    if (beat.at <= elapsed) {
      box.append(mfBeat(beat, false));
      continue;
    }
    setTimeout(() => {
      if (!box.isConnected) return;
      const line = mfBeat(beat, true);
      box.append(line);
      line.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      if (sound && beat.sound) sfx.play(beat.sound);
    }, beat.at - elapsed);
  }
  return box;
}

function mfWinnerText(winner) {
  if (winner === 'jester') return 'الانتحاري فاز! انخدعتوا فيه';
  return winner === 'mafia' ? 'المافيا فازوا!' : 'المواطنين فازوا!';
}

/** Did this role win? The jester is on nobody's side (same rule as the server's wonWith). */
function mfWon(role, winner) {
  if (!role || !winner) return false;
  if (role === 'jester' || winner === 'jester') return role === winner;
  return (role === 'mafia') === (winner === 'mafia');
}
