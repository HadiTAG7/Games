#!/usr/bin/env node
'use strict';

// Lists emoji left in the site's interface (pages, scripts, styles). The look
// is line icons (public/icons.svg, icon() in public/js/common.js), not emoji.
// What may stay: code comments, typographic symbols (✕ ✓ ▴ ▾ ↔ ↕), and emoji
// that are a game's content, marked as such: an HTML line with
// data-emoji-content, or the «تحدي الوقت» emoji cards (card.emoji). Question
// categories keep their emoji in the data but show by name, so a script that
// reads another `.emoji` (c.emoji, category.emoji…) is listed too.
// test/pages.test.js runs it; `node scripts/check_emoji.js` prints what's left.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EMOJI = /(?:[\u{1F1E6}-\u{1F1FF}]{2})|[\u{1F000}-\u{1FAFF}\u2600-\u26FF\u2B50\u2B05\u23E9-\u23FA\u231A\u231B\u21A9\u2702-\u27B0\u25B6\u25C0\u25AA\u25AB\u25FB-\u25FE\u2934\u2935\u24C2\u2139]/gu;
const ALLOWED = new Set(['✕', '✓']);
const CONTENT = ['data-emoji-content', 'card.emoji'];
// The one other `.emoji` a script may read: a custom category's, sent with its questions.
const SHOWN_EMOJI = /\b(?!card\.|custom\.)\w+\.emoji\b/;

function files() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'public'));
  const js = path.join(ROOT, 'public', 'js');
  out.push(...fs.readdirSync(js).filter((f) => f.endsWith('.js')).map((f) => path.join(js, f)));
  out.push(path.join(ROOT, 'public', 'css', 'style.css'));
  return out.sort();
}

const keepLines = (m) => '\n'.repeat(m.split('\n').length - 1);
function stripComments(text, ext) {
  let out = text;
  if (ext === '.js' || ext === '.css') out = out.replace(/\/\*[\s\S]*?\*\//g, keepLines);
  if (ext === '.js') out = out.replace(/(^|\s)\/\/[^\n]*/g, '$1');
  if (ext === '.html') out = out.replace(/<!--[\s\S]*?-->/g, keepLines);
  return out;
}

function leftovers() {
  const found = [];
  for (const file of files()) {
    const lines = stripComments(fs.readFileSync(file, 'utf8'), path.extname(file)).split('\n');
    lines.forEach((line, i) => {
      if (CONTENT.some((mark) => line.includes(mark))) return;
      const hits = (line.match(EMOJI) ?? []).filter((c) => !ALLOWED.has(c));
      if (path.extname(file) === '.js' && SHOWN_EMOJI.test(line)) hits.push(line.match(SHOWN_EMOJI)[0]);
      if (hits.length) found.push(`${path.relative(ROOT, file)}:${i + 1}: ${hits.join('')}  ${line.trim().slice(0, 90)}`);
    });
  }
  return found;
}

module.exports = { leftovers };

if (require.main === module) {
  const left = leftovers();
  console.log(left.length ? left.join('\n') : 'no emoji in the interface');
  process.exit(left.length ? 1 : 0);
}
