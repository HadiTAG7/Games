#!/usr/bin/env python3
"""Builds data/letters.json for «حروف» from scripts/letters_questions.py.

    python3 scripts/build_letters.py

Checks that every answer starts with its letter (ignoring a leading «ال»).
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import letters_questions as src  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "letters.json"
LETTERS = "أ ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن هـ و ي".split()
MIN_QUESTIONS = 15


def first_letter(answer):
    word = answer.strip()
    if word.startswith("ال") and len(word) > 3:
        word = word[2:]
    ch = word[0]
    if ch in "اأإآ":
        return "أ"
    if ch == "ه":
        return "هـ"
    return ch


def main():
    problems = []
    if list(src.LETTERS) != LETTERS:
        problems.append("letters must be the 28 Arabic letters, in order")
    letters = []
    for letter in LETTERS:
        items = src.LETTERS.get(letter, [])
        if len(items) < MIN_QUESTIONS:
            problems.append(f"{letter}: only {len(items)} questions")
        clues = [q for q, _ in items]
        if len(clues) != len(set(clues)):
            problems.append(f"{letter}: duplicate question")
        for q, a in items:
            if first_letter(a) != letter:
                problems.append(f"{letter}: answer «{a}» doesn't start with it ({q})")
        letters.append({"letter": letter, "questions": [{"q": q, "a": a} for q, a in items]})
    if problems:
        raise SystemExit("\n".join(problems))
    OUT.write_text(json.dumps({"letters": letters}, ensure_ascii=False, indent=1) + "\n")
    total = sum(len(l["questions"]) for l in letters)
    print(f"{len(letters)} letters, {total} questions written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
