'use strict';

// Questions a host writes for one room («أسئلتكم الخاصة»), in plain text:
// one question per line, with its parts split by «|».

const { GameError } = require('./errors');

const MAX_LINES = 120;
const MAX_QUESTION = 200;
const MAX_ANSWER = 80;
const MAX_NAME = 30;
const LETTERS = 'أ ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن هـ و ي'.split(' ');

const clean = (text, max) => String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** Non-empty lines, tidied. */
function lines(text) {
  return String(text ?? '').split('\n').map((l) => clean(l, 400)).filter(Boolean).slice(0, MAX_LINES);
}

/** «السؤال | الجواب», or «200 | السؤال | الجواب» when a value comes first. Returns null for a bad line. */
function splitLine(line) {
  const parts = line.split('|').map((p) => p.trim());
  if (parts.some((p) => !p)) return null;
  return parts;
}

/** The letter an answer starts with, the way «حروف» counts it (a leading «ال» is skipped). */
function letterOf(answer) {
  let word = clean(answer, MAX_ANSWER);
  if (word.startsWith('ال') && word.length > 3) word = word.slice(2);
  const ch = word[0];
  if (!ch) return null;
  if ('اأإآ'.includes(ch)) return 'أ';
  if (ch === 'ه') return 'هـ';
  return LETTERS.includes(ch) ? ch : null;
}

/** A category name and emoji typed by a host or a visitor. */
function categoryName(input) {
  const name = clean(input?.name, MAX_NAME);
  if (!name) throw new GameError('اكتب اسم الفئة');
  const emoji = clean(input?.emoji, 8) || '✍️';
  return { name, emoji };
}

module.exports = { MAX_QUESTION, MAX_ANSWER, MAX_NAME, LETTERS, clean, lines, splitLine, letterOf, categoryName };
