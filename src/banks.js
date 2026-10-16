'use strict';

// Question banks that belong to an account («بنوكي»): filled by an AI over
// MCP or pasted on the account page, and played in the owner's rooms. Each
// game says what an item looks like, how it's checked, when a bank is ready
// to play, and how it turns into the game's own content.

const { GameError } = require('./errors');
const custom = require('./custom');
const { normalizeAnswer } = require('./normalize');
const { savePicture, pictureUrl } = require('./images');
const { limiter } = require('./limits');

const LIMITS = { banks: 50, items: 1000, perCall: 200, perDay: 3000, images: 300, imagesPerCall: 30 };
const VALUES = [200, 400, 600];
const key = (text) => normalizeAnswer(String(text ?? ''));
const need = (value, message) => {
  if (!value) throw new GameError(message);
  return value;
};
const picture = (input) => {
  const url = custom.clean(input.image_url ?? input.imageUrl, 2000);
  const base64 = typeof input.image_base64 === 'string' ? input.image_base64 : null;
  return url || base64 ? { url, base64 } : null;
};
// Emoji only (with joiners and variation selectors), no letters or digits.
const isEmojiOnly = (text) => /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s]+$/u.test(text) && !/[\p{L}\p{N}]/u.test(text.replace(/[#*0-9]️?⃣/gu, ''));

/** Per game: { name, emoji, describe, check(input) → { item, picture? }, dupKey(item), publicKeys(content), playable(items), toContent(bank), parseText(text) }. */
const GAMES = {
  seen: {
    name: 'سين جيم',
    emoji: '❓',
    unit: 'سؤال',
    describe: 'The bank is one category. Each question: { value: 200 | 400 | 600 (easy, medium, hard), q: the question, a: the short answer, image_url?: a picture shown with the question }. Playable once it has at least 2 questions of each value; 4 or more of each is better.',
    paste: 'كل سطر: القيمة | السؤال | الجواب (وتقدر تضيف | رابط صورة)\n200 | كم لاعب في فريق كرة القدم؟ | 11',
    check(input) {
      const value = Number(input.value);
      if (!VALUES.includes(value)) throw new GameError('القيمة لازم تكون 200 أو 400 أو 600');
      const q = need(custom.clean(input.q, custom.MAX_QUESTION), 'السؤال ناقص');
      const a = need(custom.clean(input.a, custom.MAX_ANSWER), 'الجواب ناقص');
      return { item: { value, q, a }, picture: picture(input) };
    },
    dupKey: (item) => key(item.q),
    publicKeys: (content) => content.flatMap((c) => Object.values(c.questions).flat().map((x) => key(x.q))),
    playable: (items) => VALUES.every((v) => items.filter((i) => i.value === v).length >= 2),
    toContent: (bank) => ({
      id: `bank-${bank.id}`,
      name: bank.name,
      emoji: bank.emoji,
      bank: true,
      questions: Object.fromEntries(VALUES.map((v) => [v, bank.items.filter((i) => i.value === v)
        .map((i) => ({ q: i.q, a: i.a, ...(i.img ? { img: pictureUrl(i.img) } : {}) }))])),
    }),
    parseText: (text) => custom.lines(text).map((line) => {
      const [value, q, a, image_url] = custom.splitLine(line) ?? [];
      return { value, q, a, image_url };
    }),
  },

  letters: {
    name: 'حروف',
    emoji: '🔤',
    unit: 'سؤال',
    describe: 'Each question: { q: the question, a: the answer }. The letter is taken from the first letter of the answer (a leading «ال» is skipped), so the answer must start with an Arabic letter. Cover many different letters; the board uses 25 of the 28.',
    paste: 'كل سطر: السؤال | الجواب (الحرف ينحسب من أول حرف في الجواب)\nحيوان يلقبونه سفينة الصحراء؟ | جمل',
    check(input) {
      const q = need(custom.clean(input.q, custom.MAX_QUESTION), 'السؤال ناقص');
      const a = need(custom.clean(input.a, custom.MAX_ANSWER), 'الجواب ناقص');
      const letter = custom.letterOf(a);
      if (!letter) throw new GameError('الجواب لازم يبدأ بحرف عربي');
      return { item: { letter, q, a } };
    },
    dupKey: (item) => `${item.letter}:${key(item.q)}`,
    publicKeys: (content) => content.flatMap((l) => l.questions.map((x) => `${l.letter}:${key(x.q)}`)),
    playable: (items) => items.length >= 1,
    toContent: (bank) => bank.items.map(({ letter, q, a }) => ({ letter, q, a })),
    parseText: (text) => custom.lines(text).map((line) => {
      const [q, a] = custom.splitLine(line) ?? [];
      return { q, a };
    }),
  },

  herd: {
    name: 'عقلية القطيع',
    emoji: '🐄',
    unit: 'سؤال',
    describe: 'Each question: { mode: "same" | "different", q }. "same" (مع القطيع): an open prompt where players try to give the answer most others will give, e.g. «اذكر لون من ألوان قوس قزح». "different" (عكس القطيع): a prompt with a limited set of valid answers where players try to give a correct answer nobody else gives, e.g. «يوم من أيام الأسبوع». No answers are needed.',
    paste: 'كل سطر: مع | السؤال، أو: عكس | السؤال\nمع | اذكر أكلة سعودية مشهورة\nعكس | اذكر شهر من الأشهر الهجرية',
    check(input) {
      const mode = ['same', 'different'].includes(input.mode) ? input.mode : null;
      if (!mode) throw new GameError('الطور لازم يكون same أو different');
      const q = need(custom.clean(input.q, custom.MAX_QUESTION), 'السؤال ناقص');
      return { item: { mode, q } };
    },
    dupKey: (item) => `${item.mode}:${key(item.q)}`,
    publicKeys: (content) => content.flatMap((c) => c.subcategories.flatMap((s) => [
      ...s.same.map((q) => `same:${key(q)}`), ...s.different.map((q) => `different:${key(q)}`)])),
    playable: (items) => items.length >= 3,
    toContent: (bank) => ({
      id: `bank-${bank.id}`,
      name: bank.name,
      emoji: bank.emoji,
      bank: true,
      subcategories: [{
        id: `bank-${bank.id}-all`,
        name: bank.name,
        same: bank.items.filter((i) => i.mode === 'same').map((i) => i.q),
        different: bank.items.filter((i) => i.mode === 'different').map((i) => i.q),
      }],
    }),
    parseText: (text) => custom.lines(text).map((line) => {
      const parts = custom.splitLine(line) ?? [line];
      if (parts.length === 1) return { mode: 'same', q: parts[0] };
      const mode = /^(عكس|different)$/i.test(parts[0]) ? 'different' : /^(مع|same)$/i.test(parts[0]) ? 'same' : null;
      return { mode, q: parts.slice(1).join(' | ') };
    }),
  },

  outsider: {
    name: 'برا السالفة',
    emoji: '🤫',
    unit: 'كلمة',
    describe: 'The bank is one category of words (places, foods, people…). Each item: { word } — a concrete, well-known noun people can ask questions about. Playable from 4 words; 20 or more is better (the outsider guesses among 8).',
    paste: 'كل كلمة في سطر (أو بينها فاصلة)\nاستراحة\nمخيم\nديوانية',
    check(input) {
      const word = need(custom.clean(input.word, 30), 'الكلمة ناقصة');
      return { item: { word } };
    },
    dupKey: (item) => key(item.word),
    publicKeys: () => [],
    playable: (items) => items.length >= 4,
    toContent: (bank) => ({ id: `bank-${bank.id}`, name: bank.name, emoji: bank.emoji, bank: true, words: bank.items.map((i) => i.word) }),
    parseText: (text) => String(text ?? '').split(/[\n،,]/).map((w) => custom.clean(w, 30)).filter(Boolean).map((word) => ({ word })),
  },

  time: {
    name: 'تحدي الوقت',
    emoji: '⏱️',
    unit: 'بطاقة',
    describe: 'The bank is one wheel category. Each card: { type: "emoji", face: "🦁👑", answer } (guess from emoji), { type: "text", face: "عاصمة اليابان", answer } (short text clue), or { type: "image", image_url: a direct link to a picture (or image_base64), answer }. Answers are short (a name or a word). Playable from 15 cards; 30 or more is better.',
    paste: 'كل سطر: الوجه | الجواب. الوجه إيموجي أو نص قصير، أو: صورة | رابط الصورة | الجواب\n🦁👑 | الأسد الملك\nعاصمة اليابان | طوكيو',
    check(input) {
      const type = ['emoji', 'text', 'image'].includes(input.type) ? input.type : null;
      if (!type) throw new GameError('نوع البطاقة لازم يكون emoji أو text أو image');
      const answer = need(custom.clean(input.answer, custom.MAX_ANSWER), 'الجواب ناقص');
      if (type === 'image') {
        const pic = need(picture(input), 'رابط الصورة ناقص');
        return { item: { type, answer }, picture: pic };
      }
      const face = need(custom.clean(input.face, 80), 'وجه البطاقة ناقص');
      if (type === 'emoji' && !isEmojiOnly(face)) throw new GameError('بطاقة الإيموجي لازم تكون إيموجي بس');
      return { item: { type, face, answer } };
    },
    dupKey: (item) => `${item.face ? key(item.face) : 'img'}:${key(item.answer)}`,
    publicKeys: () => [],
    playable: (items) => items.length >= 15,
    toContent: (bank) => ({
      id: `bank-${bank.id}`,
      name: bank.name,
      emoji: bank.emoji,
      bank: true,
      cards: bank.items.map((i) => {
        if (i.type === 'image') return { type: 'image', src: pictureUrl(i.img), answer: i.answer };
        return i.type === 'emoji' ? { type: 'emoji', emoji: i.face, answer: i.answer } : { type: 'text', text: i.face, answer: i.answer };
      }),
    }),
    parseText: (text) => custom.lines(text).map((line) => {
      const parts = custom.splitLine(line) ?? [];
      if (parts.length === 3 && /^(صورة|image)$/i.test(parts[0])) return { type: 'image', image_url: parts[1], answer: parts[2] };
      const [face, answer] = parts;
      return { type: face && isEmojiOnly(face) ? 'emoji' : 'text', face, answer };
    }),
  },
};

const perDay = limiter(LIMITS.perDay, 24 * 60 * 60 * 1000);

/** A bank as the account page and the AI see it. */
function summary(bank) {
  const spec = GAMES[bank.game];
  return {
    id: bank.id,
    game: bank.game,
    gameName: spec.name,
    name: bank.name,
    emoji: bank.emoji,
    count: bank.items.length,
    images: bank.items.filter((i) => i.img).length,
    playable: spec.playable(bank.items),
    updatedAt: bank.updatedAt,
  };
}

/** Runs tasks with at most `n` at a time. */
async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

/**
 * Adds items to one of the account's banks, or to a new bank when no bankId is given.
 * Each item is checked on its own; bad ones come back in `errors` and the rest are kept.
 * publicContent: the game's shipped bank, so items already there are skipped.
 */
async function addItems(store, accountId, { game, bankId = null, name, emoji, items }, publicContent = []) {
  const spec = GAMES[game];
  if (!spec) throw new GameError('لعبة غير معروفة');
  if (!Array.isArray(items) || !items.length) throw new GameError('ما فيه عناصر');
  if (items.length > LIMITS.perCall) throw new GameError(`بالكثير ${LIMITS.perCall} عنصر في المرة`);
  let bank;
  if (bankId) {
    bank = await store.getBank(Number(bankId));
    if (!bank || bank.accountId !== accountId) throw new GameError('ما لقينا البنك');
    if (bank.game !== game) throw new GameError(`هذا البنك لـ«${GAMES[bank.game].name}»`);
  } else {
    const { name: cleanName, emoji: cleanEmoji } = custom.categoryName({ name, emoji: emoji || spec.emoji });
    if ((await store.listBanks(accountId)).length >= LIMITS.banks) throw new GameError(`بالكثير ${LIMITS.banks} بنك لكل حساب`);
    bank = await store.createBank({ accountId, game, name: cleanName, emoji: cleanEmoji });
  }

  const seen = new Set([...bank.items.map(spec.dupKey), ...spec.publicKeys(publicContent)]);
  const errors = [];
  const checked = [];
  items.forEach((input, index) => {
    try {
      const { item, picture } = spec.check(input ?? {});
      const dup = spec.dupKey(item);
      if (!picture && seen.has(dup)) throw new GameError('مكرر (موجود في البنك أو في اللعبة)');
      seen.add(dup);
      checked.push({ index, item, picture });
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      errors.push({ index, error: err.message });
    }
  });
  const room = LIMITS.items - bank.items.length;
  for (const extra of checked.splice(Math.max(0, room))) errors.push({ index: extra.index, error: `البنك وصل الحد (${LIMITS.items})` });
  if (checked.length && !perDay(accountId, checked.length)) throw new GameError(`وصلت حد اليوم (${LIMITS.perDay} عنصر)، جرّب بكرة`);

  // Pictures: fetched four at a time; a picture that fails drops only its own item.
  const withPictures = checked.filter((c) => c.picture);
  if (withPictures.length > LIMITS.imagesPerCall) throw new GameError(`بالكثير ${LIMITS.imagesPerCall} صورة في المرة`);
  if (withPictures.length && (await store.countImages(accountId)) + withPictures.length > LIMITS.images) {
    throw new GameError(`بالكثير ${LIMITS.images} صورة لكل حساب`);
  }
  await pool(withPictures.map((c) => async () => {
    try {
      c.item.img = await savePicture(store, accountId, c.picture);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      c.failed = err.message;
    }
  }), 4);

  let { nextItem } = bank;
  const added = [];
  for (const c of checked) {
    if (c.failed) {
      errors.push({ index: c.index, error: `الصورة: ${c.failed}` });
      continue;
    }
    added.push({ id: nextItem++, ...c.item });
  }
  bank = added.length ? await store.updateBank(bank.id, { items: [...bank.items, ...added], nextItem }) : bank;
  errors.sort((a, b) => a.index - b.index);
  return { bank: summary(bank), added: added.length, errors };
}

/** Removes items by id; their pictures go too. */
async function removeItems(store, accountId, bankId, ids) {
  const bank = await store.getBank(Number(bankId));
  if (!bank || bank.accountId !== accountId) throw new GameError('ما لقينا البنك');
  const gone = new Set(ids.map(Number));
  const removed = bank.items.filter((i) => gone.has(i.id));
  await store.deleteImages(removed.filter((i) => i.img).map((i) => i.img));
  const updated = await store.updateBank(bank.id, { items: bank.items.filter((i) => !gone.has(i.id)) });
  return { bank: summary(updated), removed: removed.length };
}

async function deleteBank(store, accountId, bankId) {
  const bank = await store.getBank(Number(bankId));
  if (!bank || bank.accountId !== accountId) throw new GameError('ما لقينا البنك');
  await store.deleteImages(bank.items.filter((i) => i.img).map((i) => i.img));
  await store.deleteBank(bank.id);
  return { deleted: true };
}

/** The account's ready banks for a game, turned into game content. */
async function playableContent(store, accountId, game, ids) {
  const wanted = new Set(ids.map(Number));
  return (await store.listBanks(accountId, game))
    .filter((b) => wanted.has(b.id) && GAMES[game].playable(b.items))
    .map((b) => ({ bank: summary(b), content: GAMES[game].toContent(b) }));
}

/** Instructions an AI chat can follow to write a bank someone pastes on the account page. */
function pastePrompt(game) {
  const spec = GAMES[game];
  return [
    `اكتب لي بنك أسئلة للعبة «${spec.name}» في موقع ألعاب الشلة (لعبة جماعية لشلة سعودية).`,
    'الموضوع: [اكتب الموضوع هنا].',
    `الصيغة بالضبط، بدون ترقيم ولا شرح:\n${spec.paste}`,
    'خلّ الأسئلة واضحة وبلهجة سعودية بسيطة، والأجوبة قصيرة ومتفق عليها، وبدون تكرار.',
  ].join('\n\n');
}

module.exports = { GAMES, LIMITS, addItems, removeItems, deleteBank, playableContent, summary, pastePrompt, isEmojiOnly };
