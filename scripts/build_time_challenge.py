#!/usr/bin/env python3
"""Builds data/time-challenge.json (and the city map images) for «تحدي الوقت».

    python3 scripts/build_time_challenge.py

Needs internet. Wikidata gives each item's image; the cards link to it on
Wikimedia Commons so phones load pictures straight from there (small originals
are saved under public/tc/img/). City maps are satellite views (Esri World
Imagery, no labels) saved under public/tc/maps/. Card text lives in scripts/time_challenge_sources.py.
"""

import concurrent.futures
import io
import json
import math
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import time_challenge_sources as src  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "time-challenge.json"
MAPS_DIR = ROOT / "public" / "tc" / "maps"
IMAGES_DIR = ROOT / "public" / "tc" / "img"
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


def file_name(file_uri):
    return urllib.parse.unquote(file_uri.rsplit("/", 1)[-1]).replace("_", " ")


def commons_url(file_uri, width):
    name = file_name(file_uri).replace(" ", "_")
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(name)}?width={width}"


# Phones must get a resized copy (thumb.wikimedia.org): asking for a width at
# or above the original sends them to the original file instead, which
# Wikimedia often refuses to hotlinked pages. So each card asks for the
# largest of the usual thumbnail sizes that Commons answers with a copy.
THUMB_WIDTHS = (500, 330, 250)
SIZES_CACHE = ROOT / "scripts" / ".commons-cache.json"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


NO_REDIRECT = urllib.request.build_opener(_NoRedirect)


def redirect_target(name, width):
    """Where Commons sends a request for the file at this width ("" if there's no such file)."""
    url = ("https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/"
           f"{urllib.parse.quote(name.replace(' ', '_'))}&width={width}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(6):
        try:
            with NO_REDIRECT.open(request, timeout=60):
                return ""
        except urllib.error.HTTPError as err:
            if err.code in (301, 302, 303, 307):
                return err.headers["Location"]
            if err.code == 404:
                return ""
            if attempt == 5:
                raise
            time.sleep(20 * (attempt + 1))  # rate limited
        except urllib.error.URLError:
            if attempt == 5:
                raise
            time.sleep(10)
    return ""


def probe_width(name):
    """The largest thumbnail width Commons serves as a resized copy; 0 if the
    file is smaller than all of them, None if there's no such file."""
    for width in THUMB_WIDTHS:
        target = redirect_target(name, width)
        if not target:
            return None
        if "/thumb/" in target:
            return width
    return 0


def local_copy(name):
    """Small originals are saved with the game (public/tc/img/), since Commons has no copy to hand out."""
    safe = "".join(ch if ch.isascii() and (ch.isalnum() or ch in ".-") else "_" for ch in name)
    path = IMAGES_DIR / safe
    if not path.exists():
        target = redirect_target(name, THUMB_WIDTHS[-1])
        if not target:
            return None
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(get(target.split("?")[0]))
        time.sleep(1)
    return f"/tc/img/{safe}"


class ThumbWidths:
    """Thumbnail widths by file name, probed once and cached between runs."""

    def __init__(self):
        self.cache = json.loads(SIZES_CACHE.read_text()) if SIZES_CACHE.exists() else {}

    def probe_all(self, names):
        todo = [n for n in dict.fromkeys(names) if n not in self.cache]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for i, (name, width) in enumerate(zip(todo, pool.map(probe_width, todo))):
                self.cache[name] = width
                if i % 50 == 49:
                    print(f"  thumbnail sizes: {i + 1}/{len(todo)}", file=sys.stderr)
                    self.save()
        self.save()

    def __call__(self, name):
        if name not in self.cache:
            self.cache[name] = probe_width(name)
            self.save()
        return self.cache[name]

    def save(self):
        SIZES_CACHE.write_text(json.dumps(self.cache, ensure_ascii=False, indent=0))


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


def candidates(files, props):
    """Files in order of preference: by property, then shortest name (usually the main one)."""
    for prop in props:
        usable = [u for u in files.get(prop, []) if u.rsplit(".", 1)[-1].lower() not in SKIP_EXTENSIONS]
        yield from sorted(usable, key=len)


def image_src(uri, sizes):
    name = file_name(uri)
    width = sizes(name)
    if width:
        return commons_url(uri, width)
    return local_copy(name) if width == 0 else None


def build_wikidata(category, files, sizes):
    """Titles may list alternatives separated by "|"; the first one with an image wins."""
    cards, missing = [], []
    for titles, answer in category["items"]:
        pick = next(((title, src_) for title in titles.split("|")
                     for uri in candidates(files.get(title, {}), category["props"])
                     if (src_ := image_src(uri, sizes))), None)
        if pick:
            title, src_ = pick
            cards.append({"type": "image", "src": src_, "answer": answer, "alt": title})
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
    sizes = ThumbWidths()
    # Probe each title's first choice up front, a few at a time; fallbacks are rare.
    firsts = [next(candidates(files.get(title, {}), c["props"]), None)
              for c in src.WIKIDATA for titles, _ in c["items"] for title in titles.split("|")]
    sizes.probe_all([file_name(uri) for uri in firsts if uri])
    for category in src.WIKIDATA:
        cards, missing = build_wikidata(category, files, sizes)
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
