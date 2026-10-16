#!/usr/bin/env python3
"""Builds data/time-challenge.json (and the city map images) for «تحدي الوقت».

    python3 scripts/build_time_challenge.py

Needs internet. Wikidata names each item's picture on Wikimedia Commons; the
build saves a resized copy under public/tc/img/, so the game never loads
pictures from elsewhere. City maps are satellite views (Esri World Imagery, no
labels) saved under public/tc/maps/. Card text lives in scripts/time_challenge_sources.py.
"""

import concurrent.futures
import hashlib
import io
import json
import math
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

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


def commons_path(name):
    under = name.replace(" ", "_")
    digest = hashlib.md5(under.encode()).hexdigest()
    return f"{digest[0]}/{digest[:2]}/{urllib.parse.quote(under)}", under


def picture_url(name, width):
    """Commons' resized copy of a file at this width (the original when width is 0)."""
    path, under = commons_path(name)
    if not width:
        return f"https://upload.wikimedia.org/wikipedia/commons/{path}"
    thumb = f"{width}px-{under}" + (".png" if under.lower().endswith(".svg") else "")
    return f"https://thumb.wikimedia.org/wikipedia/commons/thumb/{path}/{urllib.parse.quote(thumb)}"


# Pictures are saved with the game, so playing never depends on Wikimedia.
# They're downloaded as resized copies, at the largest of Commons' usual
# thumbnail sizes that's smaller than the original (Commons refuses floods
# of requests for original files); smaller originals are taken as they are.
THUMB_WIDTHS = (500, 330, 250)
MAX_SIDE = 500


def save_picture(name, width, crop=None):
    """Downloads a picture once, stores it as WebP under public/tc/img/ and returns its path.
    crop: (left, top, right, bottom) as fractions, to keep a logo's emblem without its lettering."""
    if crop:
        # A crop starts from a bigger copy so the emblem keeps its detail.
        if name.lower().endswith(".svg"):
            width = next((w for w in (500, 960, 1280, 1920) if w * (crop[2] - crop[0]) >= 400), 1920)
        else:
            width = next((w for w in (1280, 960) if "/thumb/" in redirect_target(name, w)), width)
    stem = "".join(ch if ch.isascii() and (ch.isalnum() or ch == "-") else "_" for ch in name.rsplit(".", 1)[0])
    key = f"{name}{crop}@{width}" if crop else name
    slug = f"{stem[:60]}-{hashlib.md5(key.encode()).hexdigest()[:6]}.webp"
    path = IMAGES_DIR / slug
    if not path.exists():
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(get(picture_url(name, width), retries=6, wait=20))))
        img = img.convert("RGBA" if "A" in img.getbands() or img.mode == "P" else "RGB")
        if crop:
            w, h = img.size
            img = img.crop((round(crop[0] * w), round(crop[1] * h), round(crop[2] * w), round(crop[3] * h)))
        img.thumbnail((MAX_SIDE, MAX_SIDE))
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        img.save(path, "WEBP", quality=75, method=6)
    return f"/tc/img/{slug}"
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


# Image, logo, flag, locator map, and the icon-only logos (small logo or icon, icon).
PROPS = ("P18", "P154", "P41", "P242", "P8972", "P2910")
ICON_PROPS = {"P8972", "P2910"}
CACHE = ROOT / "scripts" / ".wikidata-cache.json"


def wikidata_files(titles, refresh=()):
    """{title: {prop: [commons file URIs]}} for every title, cached between runs.
    Titles in refresh are asked again if they were cached before the icon properties were."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    refresh = set(refresh)
    todo = [t for t in dict.fromkeys(titles) if t not in cache or (t in refresh and "_props" not in cache[t])]
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
            cache[title] = {"_props": list(PROPS)}
        for row in rows:
            entry = cache[row["title"]["value"]]
            for prop in PROPS:
                if prop in row and row[prop]["value"] not in entry.setdefault(prop, []):
                    entry[prop].append(row[prop]["value"])
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0))
        if i + 450 < len(todo):
            time.sleep(65)
    return cache


LOGO_PROPS = {"P154", "P8972", "P2910"}


def candidates(files, props):
    """Files in order of preference: by property, then shortest name (usually the main one).
    Logos prefer vector files, which scale cleanly (a logo property can also hold a tiny favicon)."""
    for prop in props:
        usable = [u for u in files.get(prop, []) if u.rsplit(".", 1)[-1].lower() not in SKIP_EXTENSIONS]
        yield from sorted(usable, key=lambda u: (prop in LOGO_PROPS and not u.lower().endswith(".svg"), len(u)))


def build_wikidata(category, files, sizes):
    """Titles may list alternatives separated by "|"; the first one with an existing file wins.
    An item may add {"file": Commons file name} to pick its picture, and {"crop": …}.
    Cards come back with the file to download in place of a src."""
    cards, missing = [], []
    for titles, answer, *extra in category["items"]:
        options = extra[0] if extra else {}
        if "file" in options:
            uris = [(titles.split("|")[0], options["file"])]
        else:
            uris = [(title, file_name(uri)) for title in titles.split("|")
                    for uri in candidates(files.get(title, {}), category["props"])]
        pick = next(((title, name, width) for title, name in uris if (width := sizes(name)) is not None), None)
        if pick:
            title, name, width = pick
            crop = tuple(options["crop"]) if "crop" in options else None
            cards.append({"type": "image", "file": (name, width, crop), "answer": answer, "alt": title})
        else:
            missing.append(titles.split("|")[0])
    return cards, missing


def save_pictures(categories):
    """Downloads every card's picture, a few at a time, and swaps the file for its local path."""
    cards = [card for c in categories for card in c["cards"] if "file" in card]
    files = list(dict.fromkeys(card["file"] for card in cards))

    def save(file):
        try:
            return save_picture(*file)
        except Exception as err:  # leave the card out this time; the next run tries again
            print(f"  failed: {file[0]} ({err})", file=sys.stderr)
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        paths = {}
        for i, (file, path) in enumerate(zip(files, pool.map(save, files))):
            paths[file] = path
            if i % 100 == 99:
                print(f"  pictures: {i + 1}/{len(files)}", file=sys.stderr)
    for c in categories:
        c["cards"] = [{"type": card["type"], "src": paths[card["file"]], "answer": card["answer"], "alt": card["alt"]}
                      if "file" in card else card for card in c["cards"] if paths.get(card.get("file"), True)]
    # Pictures no card uses any more (a changed pick or crop) are removed.
    used = {path.rsplit("/", 1)[-1] for path in paths.values() if path}
    for path in IMAGES_DIR.glob("*.webp"):
        if path.name not in used:
            path.unlink()


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

    titles = lambda cats: [t for c in cats for titles, *_ in c["items"] for t in titles.split("|")]
    files = wikidata_files(titles(src.WIKIDATA), refresh=titles(c for c in src.WIKIDATA if ICON_PROPS & set(c["props"])))
    sizes = ThumbWidths()
    # Probe each title's first choice up front, a few at a time; fallbacks are rare.
    firsts = [next(candidates(files.get(title, {}), c["props"]), None)
              for c in src.WIKIDATA for titles, *_ in c["items"] for title in titles.split("|")]
    sizes.probe_all([file_name(uri) for uri in firsts if uri])
    for category in src.WIKIDATA:
        cards, missing = build_wikidata(category, files, sizes)
        report.append((category["id"], len(cards), missing))
        categories.append({**{k: category[k] for k in ("id", "name", "emoji")}, "cards": cards})
    save_pictures(categories)

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
