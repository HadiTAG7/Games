'use strict';

// What people can add to each game from «أضف أسئلة»: the form's fields, the
// checks, and how approved entries join the game's bank. A new game joins
// in by adding an entry to SPECS.
//
// Each entry is one flat object whose keys are the form's field keys.

const { GameError } = require('./errors');
const custom = require('./custom');
const { normalizeAnswer } = require('./normalize');

const NEW = '__new'; // the «فئة جديدة» choice
const VALUES = [200, 400, 600];
const MIN_NEW_WORDS = 6; // a new «برا السالفة» category plays once it has this many words

const key = (text) => normalizeAnswer(String(text ?? ''));
const need = (value, message) => {
  if (!value) throw new GameError(message);
  return value;
};

function hash(text) {
  let h = 5381;
  for (const ch of text) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

/** A new category's id comes from its name, so entries naming the same new category share it. */
const newId = (name) => `u-${hash(key(name))}`;

/** The category a «seen» or «outsider» entry goes into: an existing one, or a new one by name. */
function pickCategory(input, list) {
  if (input.category === NEW) {
    const { name, emoji } = custom.categoryName({ name: input.newName, emoji: input.newEmoji });
    const existing = list.find((c) => key(c.name) === key(name));
    return existing ? { category: existing.id, newName: '', newEmoji: '' } : { category: NEW, newName: name, newEmoji: emoji };
  }
  if (!list.some((c) => c.id === input.category)) throw new GameError('اختر الفئة');
  return { category: input.category, newName: '', newEmoji: '' };
}

const newCategoryFields = [
  { key: 'newName', label: 'اسم الفئة الجديدة', type: 'text', max: custom.MAX_NAME, showIf: { category: NEW } },
];
const categoryOptions = (list) => [
  ...list.map((c) => ({ value: c.id, label: c.name })),
  { value: NEW, label: '+ فئة جديدة' },
];

/** Appends approved entries to copies of the categories they belong to; new categories come after. */
function mergeInto(list, entries, { add, create }) {
  const out = list.map((c) => ({ ...c }));
  const byId = new Map(out.map((c) => [c.id, c]));
  for (const e of entries) {
    const id = e.category === NEW ? newId(e.newName) : e.category;
    let target = byId.get(id);
    if (!target && e.category === NEW) {
      target = create(id, e);
      out.push(target);
      byId.set(id, target);
    }
    if (target) add(target, e);
  }
  return out;
}

const SPECS = {
  seen: {
    name: 'سين جيم',
    emoji: '❓',
    fields: (list) => [
      { key: 'category', label: 'الفئة', type: 'select', options: categoryOptions(list) },
      ...newCategoryFields,
      { key: 'value', label: 'القيمة (الصعوبة)', type: 'select', options: VALUES.map((v) => ({ value: v, label: `${v}` })) },
      { key: 'q', label: 'السؤال', type: 'textarea', max: custom.MAX_QUESTION },
      { key: 'a', label: 'الجواب', type: 'text', max: custom.MAX_ANSWER },
    ],
    validate(input, list) {
      const value = Number(input.value);
      if (!VALUES.includes(value)) throw new GameError('اختر القيمة');
      const q = need(custom.clean(input.q, custom.MAX_QUESTION), 'اكتب السؤال');
      const a = need(custom.clean(input.a, custom.MAX_ANSWER), 'اكتب الجواب');
      const all = list.flatMap((c) => Object.values(c.questions).flat());
      if (all.some((x) => key(x.q) === key(q))) throw new GameError('هذا السؤال موجود');
      return { ...pickCategory(input, list), value, q, a };
    },
    merge: (list, entries) => mergeInto(list, entries, {
      create: (id, e) => ({ id, name: e.newName, emoji: e.newEmoji, questions: Object.fromEntries(VALUES.map((v) => [v, []])) }),
      add: (c, e) => {
        c.questions = { ...c.questions, [e.value]: [...(c.questions[e.value] ?? []), { q: e.q, a: e.a }] };
      },
    }),
    summary: (e) => `${e.value} · ${e.q} ← ${e.a}`,
  },

  letters: {
    name: 'حروف',
    emoji: '🔤',
    fields: () => [
      { key: 'q', label: 'السؤال', type: 'textarea', max: custom.MAX_QUESTION },
      { key: 'a', label: 'الجواب (الحرف ينحسب من أول حرف فيه)', type: 'text', max: custom.MAX_ANSWER },
    ],
    validate(input, list) {
      const q = need(custom.clean(input.q, custom.MAX_QUESTION), 'اكتب السؤال');
      const a = need(custom.clean(input.a, custom.MAX_ANSWER), 'اكتب الجواب');
      const letter = custom.letterOf(a);
      if (!letter) throw new GameError('الجواب لازم يبدأ بحرف عربي');
      const bank = list.find((l) => l.letter === letter);
      if (bank?.questions.some((x) => key(x.q) === key(q))) throw new GameError('هذا السؤال موجود');
      return { letter, q, a };
    },
    merge: (list, entries) => list.map((l) => {
      const mine = entries.filter((e) => e.letter === l.letter).map(({ q, a }) => ({ q, a }));
      return mine.length ? { ...l, questions: [...l.questions, ...mine] } : l;
    }),
    summary: (e) => `${e.letter} · ${e.q} ← ${e.a}`,
  },

  herd: {
    name: 'عقلية القطيع',
    emoji: '🐄',
    fields: (list) => [
      { key: 'subcategory', label: 'القسم', type: 'select',
        options: list.flatMap((c) => c.subcategories.map((s) => ({ value: s.id, label: `${c.emoji} ${c.name} · ${s.name}` }))) },
      { key: 'mode', label: 'الطور', type: 'select',
        options: [{ value: 'same', label: 'مع القطيع (جواب الأغلبية)' }, { value: 'different', label: 'عكس القطيع (جواب ينفرد فيه)' }] },
      { key: 'q', label: 'السؤال', type: 'textarea', max: custom.MAX_QUESTION, placeholder: 'مثال: اذكر لون من ألوان قوس قزح' },
    ],
    validate(input, list) {
      const sub = list.flatMap((c) => c.subcategories).find((s) => s.id === input.subcategory);
      if (!sub) throw new GameError('اختر القسم');
      if (!['same', 'different'].includes(input.mode)) throw new GameError('اختر الطور');
      const q = need(custom.clean(input.q, custom.MAX_QUESTION), 'اكتب السؤال');
      if (sub[input.mode].some((x) => key(x) === key(q))) throw new GameError('هذا السؤال موجود');
      return { subcategory: sub.id, mode: input.mode, q };
    },
    merge: (list, entries) => list.map((c) => ({
      ...c,
      subcategories: c.subcategories.map((s) => {
        const mine = entries.filter((e) => e.subcategory === s.id);
        if (!mine.length) return s;
        return {
          ...s,
          same: [...s.same, ...mine.filter((e) => e.mode === 'same').map((e) => e.q)],
          different: [...s.different, ...mine.filter((e) => e.mode === 'different').map((e) => e.q)],
        };
      }),
    })),
    summary: (e) => `${e.mode === 'same' ? 'مع القطيع' : 'عكس القطيع'}: ${e.q}`,
  },

  outsider: {
    name: 'برا السالفة',
    emoji: '🤫',
    fields: (list) => [
      { key: 'category', label: 'الفئة', type: 'select', options: categoryOptions(list) },
      ...newCategoryFields,
      { key: 'word', label: 'الكلمة', type: 'text', max: 30, placeholder: 'مثال: استراحة' },
    ],
    validate(input, list) {
      const word = need(custom.clean(input.word, 30), 'اكتب الكلمة');
      const picked = pickCategory(input, list);
      const target = list.find((c) => c.id === picked.category);
      if (target?.words.some((w) => key(w) === key(word))) throw new GameError('هذي الكلمة موجودة في الفئة');
      return { ...picked, word };
    },
    merge: (list, entries) => mergeInto(list, entries, {
      create: (id, e) => ({ id, name: e.newName, emoji: e.newEmoji, words: [] }),
      add: (c, e) => {
        if (!c.words.some((w) => key(w) === key(e.word))) c.words = [...c.words, e.word];
      },
    }).filter((c) => c.words.length >= MIN_NEW_WORDS || list.some((b) => b.id === c.id)),
    summary: (e) => e.word,
  },
};

/** The forms for «أضف أسئلة», built from each game's current bank. */
function formSpec(content) {
  return Object.entries(SPECS).map(([id, spec]) => ({ id, name: spec.name, emoji: spec.emoji, fields: spec.fields(content[id] ?? []) }));
}

module.exports = { SPECS, NEW, formSpec, newId };
