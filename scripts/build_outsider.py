#!/usr/bin/env python3
"""Builds data/outsider.json for «برا السالفة» from scripts/outsider_words.py.

    python3 scripts/build_outsider.py

Checks that every category has enough short words and that no word repeats,
inside a category or across categories. Words are compared after normalising
spaces, hamza forms (أ إ آ → ا), ة → ه, ى → ي, tatweel and diacritics.
"""

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import outsider_words as src  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "outsider.json"
MIN_WORDS = 30
MAX_PARTS = 3  # a word is at most three words long…
MAX_CHARS = 30  # …and at most this many characters
ID = re.compile(r"[a-z]+(-[a-z]+)*")
MARKS = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")  # diacritics, tatweel
LETTERS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي"})


def normalise(word):
    return " ".join(MARKS.sub("", word).translate(LETTERS).split())


def main():
    problems = []
    categories = []
    ids, names, seen = set(), set(), {}
    for cat in src.CATEGORIES:
        cid, name, emoji, words = (cat.get(k) for k in ("id", "name", "emoji", "words"))
        label = cid or name or "?"
        if not isinstance(cid, str) or not ID.fullmatch(cid):
            problems.append(f"{label}: id must be lowercase ascii letters and hyphens")
        elif cid in ids:
            problems.append(f"{cid}: id used twice")
        ids.add(cid)
        if not isinstance(name, str) or not name.strip():
            problems.append(f"{label}: missing name")
        elif normalise(name) in names:
            problems.append(f"{label}: name «{name}» used twice")
        else:
            names.add(normalise(name))
        if not isinstance(emoji, str) or not emoji.strip():
            problems.append(f"{label}: missing emoji")
        if not isinstance(words, list):
            problems.append(f"{label}: words must be a list")
            continue
        if len(words) < MIN_WORDS:
            problems.append(f"{label}: only {len(words)} words (need {MIN_WORDS})")
        for word in words:
            if not isinstance(word, str) or not word.strip():
                problems.append(f"{label}: empty word")
                continue
            if word != word.strip():
                problems.append(f"{label}: «{word}» has leading/trailing spaces")
            if len(word.split()) > MAX_PARTS or len(word) > MAX_CHARS:
                problems.append(f"{label}: «{word}» is too long")
            key = normalise(word)
            if key in seen:
                other, first = seen[key]
                where = "twice" if other == label else f"also in {other}"
                problems.append(f"{label}: «{word}» repeats «{first}» ({where})")
            else:
                seen[key] = (label, word)
        categories.append({"id": cid, "name": name, "emoji": emoji, "words": words})
    if not categories:
        problems.append("no categories")
    if problems:
        raise SystemExit("\n".join(problems))
    OUT.write_text(json.dumps({"categories": categories}, ensure_ascii=False, indent=1) + "\n")
    total = sum(len(c["words"]) for c in categories)
    print(f"{len(categories)} categories, {total} words written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
