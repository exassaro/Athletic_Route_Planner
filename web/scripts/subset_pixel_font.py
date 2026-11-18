"""Builds the GATHO pixel font: Silkscreen Regular (SIL OFL 1.1, no Reserved Font Name) from a pinned google/fonts
commit, cut down to the characters the pixel type uses (the wordmark and the stat numbers, blueprint Phase 5b
amendment 3), with tabular figures: Silkscreen's "1" is narrower than the other digits, so it is widened to their
advance and centred. Writes web/src/fonts/pixel-gatho.woff2 and the licence beside it.

Silkscreen replaced Pixelify Sans on 2026-11-18 (product owner): Pixelify's "5" reads as an "S" at every weight.

    uv run --no-project --with fonttools --with brotli python web/scripts/subset_pixel_font.py
"""
import hashlib
import shutil
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

COMMIT = "8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5"   # google/fonts, 2026-03-12
BASE = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl/silkscreen/"
FILES = {
    "Silkscreen-Regular.ttf": "c845473330b94c2079ce9af01c51ac8ba2d99c24f4d14c039843bbb8e642ebd8",
    "OFL.txt": "86c5e9c9382cdcc5948704fdfe60f2aa164a719746931219a42736ecd9cefbd3",
}
TEXT = "GATHO0123456789.,:+± "

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "fonts"
CACHE = ROOT.parent / "data" / "fonts" / "silkscreen" / COMMIT[:12]


def fetch(name: str, sha: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        with urllib.request.urlopen(BASE + name, timeout=60) as r:
            path.write_bytes(r.read())
    got = hashlib.sha256(path.read_bytes()).hexdigest()
    if got != sha:
        sys.exit(f"{path.name}: sha256 {got}, expected {sha}")
    return path


def main() -> None:
    ttf = fetch("Silkscreen-Regular.ttf", FILES["Silkscreen-Regular.ttf"])
    licence = fetch("OFL.txt", FILES["OFL.txt"])

    font = TTFont(ttf)
    opts = subset.Options()
    opts.layout_features = ["kern"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text=TEXT)
    sub.subset(font)

    # Tabular figures: every digit gets the advance of "0"; narrower digits are centred.
    cmap, hmtx, glyf = font.getBestCmap(), font["hmtx"], font["glyf"]
    width = hmtx[cmap[ord("0")]][0]
    for d in "0123456789":
        name = cmap[ord(d)]
        adv, lsb = hmtx[name]
        if adv == width:
            continue
        shift = (width - adv) // 2
        g = glyf[name]
        if g.isComposite():
            for c in g.components:
                c.x += shift
        else:
            g.coordinates.translate((shift, 0))
        g.recalcBounds(glyf)
        hmtx[name] = (width, lsb + shift)
    widths = {hmtx[cmap[ord(d)]][0] for d in "0123456789"}
    assert widths == {width}, widths

    OUT.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    target = OUT / "pixel-gatho.woff2"
    font.save(target)
    shutil.copyfile(licence, OUT / "OFL-Silkscreen.txt")
    print(f"{target.relative_to(ROOT.parent)}: {target.stat().st_size} bytes, {len(font.getGlyphOrder())} glyphs, "
          f"digits {width} units wide")


if __name__ == "__main__":
    main()
