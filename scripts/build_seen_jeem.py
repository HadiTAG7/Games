#!/usr/bin/env python3
"""Builds data/seen-jeem.json for «سين جيم» from scripts/seen_jeem_questions.py.

    python3 scripts/build_seen_jeem.py

Picture questions reuse the pictures saved for «تحدي الوقت», so run
scripts/build_time_challenge.py first if those changed. No internet needed.
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import seen_jeem_questions as src  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "seen-jeem.json"
TIME_CHALLENGE = ROOT / "data" / "time-challenge.json"
VALUES = (200, 400, 600)
MIN_PER_VALUE = 4  # a game takes two, so this is enough for two games without repeats


def picture_of(cards, answer):
    card = cards.get(answer)
    if not card:
        raise SystemExit(f"no «تحدي الوقت» picture for {answer!r}")
    return card["src"] if "src" in card else f"/flags/4x3/{card['code']}.svg"


def main():
    time_cards = {c["id"]: c["cards"] for c in json.loads(TIME_CHALLENGE.read_text())["categories"]}
    categories = []
    for c in src.TEXT:
        questions = {str(v): [{"q": q, "a": a} for q, a in c[v]] for v in VALUES}
        categories.append({"id": c["id"], "name": c["name"], "emoji": c["emoji"], "questions": questions})
    for c in src.PICTURES:
        cards = {card["answer"]: card for cid in c["from"] for card in time_cards[cid]}
        questions = {str(v): [{"q": c["prompt"], "a": a, "img": picture_of(cards, a)} for a in c[v]] for v in VALUES}
        categories.append({"id": c["id"], "name": c["name"], "emoji": c["emoji"], "questions": questions})

    problems = []
    ids = [c["id"] for c in categories]
    if len(ids) != len(set(ids)):
        problems.append("duplicate category ids")
    for c in categories:
        for v in VALUES:
            items = c["questions"][str(v)]
            if len(items) < MIN_PER_VALUE:
                problems.append(f"{c['id']} {v}: only {len(items)} questions")
            keys = [(q["q"], q["a"]) for q in items]
            if len(keys) != len(set(keys)):
                problems.append(f"{c['id']} {v}: duplicate question")
    if problems:
        raise SystemExit("\n".join(problems))

    OUT.write_text(json.dumps({"categories": categories}, ensure_ascii=False, indent=1) + "\n")
    total = sum(len(q) for c in categories for q in c["questions"].values())
    print(f"{len(categories)} categories, {total} questions written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
