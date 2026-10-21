#!/usr/bin/env python3
"""Builds public/icons.svg: the site's icons as one SVG sprite.

The icons are Lucide's (https://lucide.dev, ISC License). Download the
package once and point this script at its icons folder:

    npm pack lucide-static@1.61.0 && tar -xzf lucide-static-1.61.0.tgz
    python3 scripts/build_icons.py package/icons

Each icon becomes <symbol id="i-NAME">, drawn with the page's text colour
(stroke="currentColor"). Pages use it as
<svg class="icon"><use href="/icons.svg#i-NAME"/></svg>, and scripts call
icon('NAME') from public/js/common.js. Add a name to ICONS to use a new one.
"""

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'icons.svg'
LICENSE_OUT = ROOT / 'public' / 'icons-LICENSE.txt'
# Single files too, for CSS masks (each game's faint emblem in the corner) and the favicon.
SINGLE_DIR = ROOT / 'public' / 'icons'
SINGLE = ['dices', 'users-round', 'timer', 'circle-help', 'hexagon', 'venetian-mask', 'drama', 'chart-bar-big', 'pointer', 'circle-check-big']
FAVICON = ROOT / 'public' / 'favicon.svg'

ICONS = sorted(set('''
    arrow-left arrow-right award badge-check ban bell-ring bot brain camera cast chart-bar-big chart-column check
    chevron-down circle-check circle-check-big circle-dashed circle-help circle-plus circle-x clapperboard
    clipboard-copy coins compass copy crosshair crown dices door-open drama ear-off eye eye-off ferris-wheel flag
    flame gamepad-2 gem ghost hand hand-coins hand-grab handshake heart hexagon hourglass house image image-off
    info joystick key-round landmark laptop library lightbulb link list list-ordered lock log-in log-out map
    medal megaphone message-circle mic microscope monitor moon music notebook-pen party-popper pause pen-line
    pencil phone plane play plug plus pointer popcorn qr-code refresh-cw repeat rocket rotate-ccw save scroll
    search send settings shield shuffle skip-back skip-forward skull smartphone sparkles split square-pen star
    stethoscope sun swords tag thumbs-up timer timer-reset trash-2 trending-up triangle-alert trophy tv undo-2
    user user-round users users-round venetian-mask volume-2 volume-x vote wand-sparkles wrench x zap laugh
'''.split()))


def inner(svg_text):
    """The drawing inside one Lucide file, without its <svg> wrapper or comments."""
    body = re.sub(r'<!--.*?-->', '', svg_text, flags=re.S)
    match = re.search(r'<svg[^>]*>(.*)</svg>', body, flags=re.S)
    if not match:
        raise ValueError('not an SVG')
    return re.sub(r'\s+', ' ', match.group(1)).strip()


def main():
    if len(sys.argv) != 2:
        sys.exit('usage: build_icons.py <lucide-static>/icons')
    source = Path(sys.argv[1])
    missing = [name for name in ICONS if not (source / f'{name}.svg').exists()]
    if missing:
        sys.exit(f'missing icons: {", ".join(missing)}')
    symbols = [
        f'<symbol id="i-{name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        f'stroke-linecap="round" stroke-linejoin="round">{inner((source / f"{name}.svg").read_text())}</symbol>'
        for name in ICONS
    ]
    OUT.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg">\n'
        '<!-- Icons from Lucide (https://lucide.dev), ISC License: see icons-LICENSE.txt -->\n'
        + '\n'.join(symbols) + '\n</svg>\n',
        encoding='utf-8',
    )
    SINGLE_DIR.mkdir(exist_ok=True)
    for name in SINGLE:
        (SINGLE_DIR / f'{name}.svg').write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round">{inner((source / f"{name}.svg").read_text())}</svg>\n',
            encoding='utf-8',
        )
    # The site's mark: dice on a yellow tile.
    FAVICON.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#ffd23f"/>'
        '<g transform="translate(4 4)" fill="none" stroke="#2a1d00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        f'{inner((source / "dices.svg").read_text())}</g></svg>\n',
        encoding='utf-8',
    )
    license_file = source.parent / 'LICENSE'
    if license_file.exists():
        shutil.copyfile(license_file, LICENSE_OUT)
    print(f'{len(ICONS)} icons written to {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB), '
          f'{len(SINGLE)} single files and the favicon')


if __name__ == '__main__':
    main()
