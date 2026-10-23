'use strict';

// The narrator of «مافيا»: what happened tonight (or at the vote), told as a
// short story, one line at a time. The server writes it so the big screen and
// every phone show the same lines at the same moments; a page opened midway
// picks up where the story is.
//
// A line: { at, kind, tone, icon, sound, text, who, death, votes, max, none }
//   at    ms from the start of the story
//   kind  scene | line | suspense | reveal | tally | role
//   tone  calm | danger | good | bad
//   text  «{name}» stands for the player in `who`, «{role}» for their role
// Phrasing never assumes whether a player is a man or a woman.

// How long each kind of line stays alone before the next one comes.
const HOLD = { scene: 2800, line: 2600, suspense: 2400, reveal: 2800, tally: 1100, role: 2600, end: 2600 };

const NIGHTS = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'];

const LINES = {
  opening: [
    'الليلة {night}… الحارة نامت، والقمر شاهد على كل شي.',
    'طفّت الأنوار وحدة ورا الثانية، والكل راح في سابع نومة… الليلة {night}.',
    'الليلة {night}: الشوارع فاضية، والهدوء مخيّم… بس فيه ناس ما ناموا.',
    'ريح باردة تصفّر بين البيوت… والليلة {night} بدت.',
    'سكتت الحارة، وما بقى إلا صوت الساعة… الليلة {night}.',
  ],
  mafiaMove: [
    'ظلال سودا تحركت بين البيوت… المافيا اختاروا هدفهم.',
    'المافيا طلعوا من مخابيهم، وكل واحد عارف وين رايح.',
    'خطوات خفيفة في الظلام… المافيا بدوا شغلهم.',
    'في زاوية مظلمة، المافيا اتفقوا على اسم واحد…',
  ],
  atDoor: [
    'تسللوا لبيت {name}…',
    'وقفوا عند باب {name}، وفتحوه بهدوء…',
    'وصلوا لبيت {name}، والنور طافي…',
    'دخلوا غرفة {name} على أطراف أصابعهم…',
  ],
  saved: [
    'لكن لحسن الحظ… الدكتور كان سابقهم! {name} بخير.',
    'وقبل الضربة بثانية… طلع لهم الدكتور! {name} للحين معنا.',
    'بس الدكتور كان مسهّر الليلة… وأنقذ {name} في آخر لحظة!',
    'لكن الدكتور كان أسرع منهم… وأنقذ {name}!',
  ],
  died: [
    'وما لحق أحد يفزع… خسرنا {name}.',
    'والدكتور ما كان هناك هالمرة… ضحية المافيا الليلة: {name}.',
    'وانتهت حكاية {name} الليلة…',
    'الباب انقفل… وما عاد أحد بيشوف {name} بيننا.',
  ],
  mafiaSplit: [
    'المافيا اختلفوا على الضحية… وطلع الفجر وهم للحين يتجادلون!',
    'كل واحد من المافيا يبي اسم… وضاعت عليهم الليلة!',
    'المافيا تهاوشوا بينهم، وما قدروا يتفقون على أحد.',
  ],
  mafiaHesitated: [
    'المافيا وصلوا للباب… وترددوا في آخر لحظة!',
    'كانوا متفقين، بس محد تجرأ يعتمد… ورجعوا بدون ضحية.',
    'المافيا تراجعوا في آخر ثانية… والحارة نجت منهم الليلة.',
  ],
  mafiaIdle: [
    'المافيا الليلة ما تحركوا… يمكن يخططون لشي أكبر.',
    'ما انسمع للمافيا حس الليلة… هدوء يخوّف.',
    'المافيا قعدوا في مكانهم الليلة… وش ناوين عليه؟',
  ],
  sameShot: [
    'وبنفس اللحظة… دوّى صوت طلقة على نفس البيت!',
    'وكأن هذا ما يكفي… القنّاص صوّب على نفس الهدف!',
  ],
  shotRing: [
    'وفجأة… دوّى صوت طلقة في سكون الليل!',
    'طااخ! صوت طلقة صحّى نص الحارة!',
    'وسط الهدوء… انطلقت رصاصة القنّاص!',
  ],
  shotAt: [
    'الطلقة كانت رايحة لـ{name}…',
    'القنّاص صوّب على {name}…',
    'والرصاصة اتجهت لـ{name}…',
  ],
  savedShot: [
    'بس الدكتور كان قريب… ولحق على {name} في الوقت المناسب!',
    'لحسن الحظ الإصابة خفيفة، والدكتور عالج {name} على طول!',
  ],
  diedShot: [
    'والطلقة كانت في مكانها… خسرنا {name}.',
    'وما لحق الدكتور… انتهت حكاية {name}.',
    'طلقة وحدة كانت كافية… وداعًا {name}.',
  ],
  dawnSafe: [
    'وطلعت الشمس… والكل صحى بالسلامة!',
    'الشمس طلعت… والحارة كاملة، محد نقص الليلة.',
    'شروق جميل… وكل الوجيه موجودة!',
  ],
  dawnOne: [
    'وطلعت الشمس… بس فيه مكان فاضي اليوم.',
    'صباح ثقيل على الحارة… خسرنا واحد.',
    'الشمس طلعت، والحزن مخيّم على الحارة…',
  ],
  dawnMany: [
    'صباح ثقيل… خسرنا {count} الليلة!',
    'ليلة سودا… {count} ما صحوا اليوم.',
  ],
  voteOpen: [
    'التصويت انقفل… خلونا نعد الأصوات.',
    'الأصوات وصلت… والحارة كلها تنتظر.',
    'لحظة الحقيقة… نعد الأصوات وحدة وحدة.',
  ],
  voteSuspense: ['والأكثر أصوات…', 'والحارة قررت…', 'واللي بيطلع من اللعبة…'],
  out: [
    'الحارة قالت كلمتها: {name} برا اللعبة!',
    'وداعًا {name}… الأصوات حكمت.',
    '{name}! خلاص، هذا قرار الحارة.',
  ],
  roleSuspense: ['والدور الحقيقي…', 'وانكشفت الأوراق…', 'والسؤال الحين: مين كان {name} فعلاً؟'],
  roleMafia: ['من المافيا! ضربة موفقة.', 'مافيا! الحارة صادت واحد منهم.'],
  roleJester: ['الانتحاري! كان يبي يطلع… وضحك عليكم كلكم.', 'الانتحاري! وهذا بالضبط اللي كان يبيه.'],
  roleTown: ['بريء… كان {role}.', '{role}! طلّعتوا واحد منكم.', 'آخ… كان {role}، والمافيا للحين بينكم.'],
  tie: ['تعادل! والحارة ما قدرت تقرر… محد يطلع.', 'الأصوات تساوت… محد يطلع هالمرة.'],
  noneWins: ['الأغلبية قالت: ما نطلّع أحد اليوم.', 'الحارة اختارت تنتظر… محد يطلع.'],
  noVotes: ['محد صوّت… ومحد يطلع.'],
};

const COUNTS = { 2: 'اثنين', 3: 'ثلاثة', 4: 'أربعة' };

/** Lines one after the other: add(line, hold) places each `hold` ms after the one before. */
function teller(random) {
  const beats = [];
  let at = 0;
  return {
    pick: (key) => LINES[key][Math.floor(random() * LINES[key].length)],
    add(beat, hold) {
      beats.push({ at, who: null, death: false, sound: null, ...beat });
      at += hold;
    },
    done: () => ({ beats, length: at }),
  };
}

/**
 * Tonight's story. plan: where the mafia stood ({ pointed, agreed }); victim: the
 * mafia's (if they agreed); shot: the sniper's target; deaths: who dies (the
 * attacked the doctor didn't save). A save nobody needed isn't told.
 */
function nightStory({ dayNumber, plan, victim, shot, deaths, random = Math.random }) {
  const t = teller(random);
  const night = NIGHTS[dayNumber - 1] ?? String(dayNumber);
  const outcome = (id, byShot) => (deaths.includes(id)
    ? t.add({ kind: 'reveal', tone: 'bad', icon: 'skull', sound: 'lose', text: t.pick(byShot ? 'diedShot' : 'died'), who: id, death: true }, HOLD.reveal)
    : t.add({ kind: 'reveal', tone: 'good', icon: 'stethoscope', sound: 'correct', text: t.pick(byShot ? 'savedShot' : 'saved'), who: id }, HOLD.reveal));

  t.add({ kind: 'scene', tone: 'calm', icon: 'moon', text: t.pick('opening').replace('{night}', night) }, HOLD.scene);
  if (victim) {
    t.add({ kind: 'line', tone: 'danger', icon: 'swords', text: t.pick('mafiaMove') }, HOLD.line);
    t.add({ kind: 'suspense', tone: 'danger', icon: 'door-open', sound: 'heartbeat', text: t.pick('atDoor'), who: victim }, HOLD.suspense);
    if (shot === victim) t.add({ kind: 'suspense', tone: 'danger', icon: 'crosshair', sound: 'shot', text: t.pick('sameShot'), who: victim }, HOLD.suspense);
    outcome(victim, false);
  } else if (plan.pointed) {
    t.add({ kind: 'line', tone: 'calm', icon: 'swords', text: t.pick(plan.agreed ? 'mafiaHesitated' : 'mafiaSplit') }, HOLD.line);
  } else {
    t.add({ kind: 'line', tone: 'calm', icon: 'swords', text: t.pick('mafiaIdle') }, HOLD.line);
  }
  if (shot && shot !== victim) {
    t.add({ kind: 'suspense', tone: 'danger', icon: 'crosshair', sound: 'shot', text: t.pick('shotRing') }, HOLD.suspense);
    t.add({ kind: 'suspense', tone: 'danger', icon: 'crosshair', sound: 'heartbeat', text: t.pick('shotAt'), who: shot }, HOLD.suspense);
    outcome(shot, true);
  }
  const dawn = deaths.length === 0 ? t.pick('dawnSafe') : deaths.length === 1 ? t.pick('dawnOne') : t.pick('dawnMany');
  t.add({
    kind: 'scene', tone: deaths.length ? 'bad' : 'good', icon: 'sun', sound: deaths.length ? null : 'morning',
    text: dawn.replace('{count}', COUNTS[deaths.length] ?? String(deaths.length)),
  }, HOLD.end);
  return t.done();
}

/**
 * The vote, counted out loud: each name's votes from the fewest up, then who
 * goes (and, when roles show on death, what they were). tally: [{ target, votes }]
 * most first, target an id or 'none'; out: who goes, or null; role: theirs.
 */
function voteStory({ tally, out, role, revealOnDeath, random = Math.random }) {
  const t = teller(random);
  t.add({ kind: 'scene', tone: 'calm', icon: 'vote', text: t.pick('voteOpen') }, HOLD.scene);
  const max = Math.max(1, ...tally.map((row) => row.votes));
  for (const row of [...tally].reverse()) {
    const none = row.target === 'none';
    t.add({ kind: 'tally', tone: 'calm', icon: none ? 'ban' : 'user', sound: 'tick', who: none ? null : row.target, none, votes: row.votes, max }, HOLD.tally);
  }
  if (!tally.length) {
    t.add({ kind: 'reveal', tone: 'calm', icon: 'handshake', sound: 'skip', text: t.pick('noVotes') }, HOLD.reveal);
    return t.done();
  }
  t.add({ kind: 'suspense', tone: 'danger', icon: 'vote', sound: 'drumroll', text: t.pick('voteSuspense') }, HOLD.suspense);
  if (out) {
    t.add({ kind: 'reveal', tone: 'bad', icon: 'door-open', sound: 'wrong', text: t.pick('out'), who: out }, HOLD.reveal);
    if (revealOnDeath) {
      t.add({ kind: 'suspense', tone: 'danger', icon: 'drama', sound: 'heartbeat', text: t.pick('roleSuspense'), who: out }, HOLD.suspense);
      const caught = role === 'mafia';
      const key = caught ? 'roleMafia' : role === 'jester' ? 'roleJester' : 'roleTown';
      t.add({ kind: 'role', tone: caught ? 'good' : 'bad', icon: caught ? 'swords' : role === 'jester' ? 'laugh' : 'user', sound: caught ? 'correct' : 'lose', text: t.pick(key), who: out, death: true }, HOLD.role);
    }
  } else if (tally[0].target === 'none') {
    t.add({ kind: 'reveal', tone: 'calm', icon: 'ban', sound: 'skip', text: t.pick('noneWins') }, HOLD.reveal);
  } else {
    t.add({ kind: 'reveal', tone: 'calm', icon: 'handshake', sound: 'skip', text: t.pick('tie') }, HOLD.reveal);
  }
  return t.done();
}

module.exports = { nightStory, voteStory, LINES, HOLD };
