#!/usr/bin/env python3
"""Builds data/time-challenge.json (and the city map images) for «تحدي الوقت».

    python3 scripts/build_time_challenge.py

Needs internet. Wikidata gives each item's image; the cards link to it on
Wikimedia Commons so phones load pictures straight from there. City maps are
satellite views (Esri World Imagery, no labels) saved under public/tc/maps/. Card text lives in scripts/time_challenge_sources.py.
"""

import io
import json
import math
import pathlib
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import time_challenge_sources as src  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "time-challenge.json"
MAPS_DIR = ROOT / "public" / "tc" / "maps"
FLAGS_DIR = ROOT / "node_modules" / "flag-icons" / "flags" / "4x3"
USER_AGENT = "HadiGamesBot/1.0 (personal party game; https://github.com/HadiTAG7/Games)"
MIN_CARDS = 15
SKIP_EXTENSIONS = {"tif", "tiff", "pdf", "djvu", "webm", "ogv", "ogg"}


def get(url, accept=None, data=None, retries=5, wait=5):
    headers = {"User-Agent": USER_AGENT}
    if accept:
        headers["Accept"] = accept
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers, data=data)
            with urllib.request.urlopen(req, timeout=180) as res:
                return res.read()
        except Exception as err:  # retry rate limits and hiccups
            if attempt == retries - 1:
                raise
            print(f"  retry after {err}", file=sys.stderr)
            time.sleep(wait * (attempt + 1))


def sparql(query):
    # The query service allows about one request a minute right now, so the
    # build asks for every category in a few large POSTs.
    data = urllib.parse.urlencode({"query": query}).encode()
    body = get("https://query.wikidata.org/sparql", accept="application/sparql-results+json", data=data, wait=65)
    return json.loads(body)["results"]["bindings"]


def commons_url(file_uri, width=500):
    name = urllib.parse.unquote(file_uri.rsplit("/", 1)[-1])
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(name.replace(' ', '_'))}?width={width}"


PROPS = ("P18", "P154", "P41", "P242")
CACHE = ROOT / "scripts" / ".wikidata-cache.json"


def wikidata_files(titles):
    """{title: {prop: [commons file URIs]}} for every title, cached between runs."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [t for t in dict.fromkeys(titles) if t not in cache]
    for i in range(0, len(todo), 450):
        chunk = todo[i:i + 450]
        print(f"  wikidata: {len(chunk)} titles", file=sys.stderr)
        values = " ".join('"%s"@en' % t.replace('"', '\\"') for t in chunk)
        optionals = " ".join(f"OPTIONAL {{ ?item wdt:{p} ?{p} }}" for p in PROPS)
        rows = sparql(f"""SELECT ?title {' '.join('?' + p for p in PROPS)} WHERE {{
          VALUES ?title {{ {values} }}
          ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .
          {optionals}
        }}""")
        for title in chunk:
            cache[title] = {}
        for row in rows:
            entry = cache[row["title"]["value"]]
            for prop in PROPS:
                if prop in row and row[prop]["value"] not in entry.setdefault(prop, []):
                    entry[prop].append(row[prop]["value"])
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0))
        if i + 450 < len(todo):
            time.sleep(65)
    return cache


def pick_file(files, props):
    """The first property with a usable file; the shortest name is usually the main one."""
    for prop in props:
        usable = [u for u in files.get(prop, []) if u.rsplit(".", 1)[-1].lower() not in SKIP_EXTENSIONS]
        if usable:
            return min(usable, key=len)
    return None


def build_wikidata(category, files):
    """Titles may list alternatives separated by "|"; the first one with an image wins."""
    cards, missing = [], []
    for titles, answer in category["items"]:
        for title in titles.split("|"):
            uri = pick_file(files.get(title, {}), category["props"])
            if uri:
                cards.append({"type": "image", "src": commons_url(uri), "answer": answer, "alt": title})
                break
        else:
            missing.append(titles.split("|")[0])
    return cards, missing


def tile_xy(lat, lon, zoom):
    n = 2 ** zoom
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def build_city_map(key, lat, lon, zoom, size=640):
    """A label-free satellite view of the city (Esri World Imagery), saved once."""
    path = MAPS_DIR / f"{key}.jpg"
    if path.exists():
        return path
    tile = 256
    x, y = tile_xy(lat, lon, zoom)
    left, top = x * tile - size / 2, y * tile - size / 2
    tx0, ty0 = int(left // tile), int(top // tile)
    tx1, ty1 = int((left + size) // tile), int((top + size) // tile)
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * tile, (ty1 - ty0 + 1) * tile))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{ty}/{tx}"
            img = Image.open(io.BytesIO(get(url))).convert("RGB")
            canvas.paste(img, ((tx - tx0) * tile, (ty - ty0) * tile))
    ox, oy = left - tx0 * tile, top - ty0 * tile
    crop = canvas.crop((int(ox), int(oy), int(ox) + size, int(oy) + size))
    MAPS_DIR.mkdir(parents=True, exist_ok=True)
    crop.save(path, "JPEG", quality=80, optimize=True)
    return path


def main():
    categories, report = [], []

    files = wikidata_files([t for c in src.WIKIDATA for titles, _ in c["items"] for t in titles.split("|")])
    for category in src.WIKIDATA:
        cards, missing = build_wikidata(category, files)
        report.append((category["id"], len(cards), missing))
        categories.append({**{k: category[k] for k in ("id", "name", "emoji")}, "cards": cards})

    flags = [(code, name) for code, name in src.FLAGS if (FLAGS_DIR / f"{code}.svg").exists()]
    categories.append({"id": "flags", "name": "أعلام الدول", "emoji": "🏳️",
                       "cards": [{"type": "flag", "code": c, "answer": n} for c, n in flags]})
    categories.append({"id": "hidden-flags", "name": "العلم المخفي", "emoji": "🫣",
                       "cards": [{"type": "hidden-flag", "code": c, "answer": n} for c, n in flags]})

    maps = []
    for key, name, lat, lon, zoom in src.CITY_MAPS:
        print(f"map: {key}", file=sys.stderr)
        build_city_map(key, lat, lon, zoom)
        maps.append({"type": "map", "src": f"/tc/maps/{key}.jpg", "answer": name})
    categories.append({"id": "city-maps", "name": "خرائط مدن", "emoji": "🧭", "cards": maps})

    for category in src.EMOJI:
        categories.append({**{k: category[k] for k in ("id", "name", "emoji")},
                           "cards": [{"type": "emoji", "emoji": e, "answer": a} for e, a in category["items"]]})

    def roman(n):
        out = ""
        for value, letters in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
                               (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
            while n >= value:
                out += letters
                n -= value
        return out

    categories.append({"id": "roman", "name": "أرقام رومانية", "emoji": "🏛️",
                       "cards": [{"type": "text", "text": roman(n), "answer": str(n)} for n in src.ROMAN]})

    for category in src.TEXT:
        categories.append({**{k: category[k] for k in ("id", "name", "emoji")},
                           "cards": [{"type": "text", "text": category["prompt"].format(q), "answer": a}
                                     for q, a in category["items"]]})

    kept = [c for c in categories if len(c["cards"]) >= MIN_CARDS]
    dropped = [c["id"] for c in categories if len(c["cards"]) < MIN_CARDS]
    OUT.write_text(json.dumps({"categories": kept}, ensure_ascii=False, indent=1) + "\n")

    print("\n== Wikidata coverage ==")
    for cid, count, missing in report:
        print(f"{cid}: {count} cards" + (f"; missing {len(missing)}: {', '.join(missing)}" if missing else ""))
    print(f"\n{len(kept)} categories, {sum(len(c['cards']) for c in kept)} cards written to {OUT.relative_to(ROOT)}")
    if dropped:
        print("dropped (too few cards):", ", ".join(dropped))


if __name__ == "__main__":
    main()
