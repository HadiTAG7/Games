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

// «1.», «١-», «(3)», «•», «- » at the start of a line: list marks an AI chat puts on what it writes.
const LIST_MARK = /^(?:\(?[0-9٠-٩]{1,3}[.)\-–:،](?![0-9٠-٩])\s*|[-•*▪◦·]\s+)/;

/**
 * Non-empty lines, tidied. Text copied from an AI chat works as is: list
 * marks, **bold** and # headings go, and when most lines are a numbered or
 * bulleted list, the lines around it (a title, «جاوب بالإجابة…») are left out.
 */
function lines(text) {
  const raw = String(text ?? '').split('\n').map((l) => l.replace(/\*\*|__/g, '').trim()).filter((l) => l && !l.startsWith('#'));
  const listed = raw.filter((l) => LIST_MARK.test(l));
  const keep = listed.length >= 3 && listed.length * 2 >= raw.length ? listed : raw;
  return keep.map((l) => clean(l.replace(LIST_MARK, ''), 400)).filter(Boolean).slice(0, MAX_LINES);
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
