'use strict';

// Tashkeel, Quranic marks and superscript alef.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

const LETTER_MAP = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
  'ة': 'ه',
  'ى': 'ي', 'ی': 'ي', 'ئ': 'ي',
  'ؤ': 'و',
  'ک': 'ك',
};
const LETTER_RE = new RegExp(`[${Object.keys(LETTER_MAP).join('')}]`, 'g');

function stripArticle(word) {
  return word.length > 3 && word.startsWith('ال') ? word.slice(2) : word;
}

/**
 * Turns a free-text answer into a comparison key so that spelling variants
 * such as «الأحمر» و«احمر» و«أحمرْ» end up in the same group.
 */
function normalizeAnswer(input) {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFKC').toLowerCase();
  s = s.replace(DIACRITICS, '').replace(TATWEEL, '');
  s = s.replace(LETTER_RE, (ch) => LETTER_MAP[ch]);
  s = s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  const key = s.trim().split(/\s+/).filter(Boolean).map(stripArticle).join(' ');
  // Emoji-only answers have no letters left; compare them as typed.
  return key || input.trim();
}

module.exports = { normalizeAnswer };
