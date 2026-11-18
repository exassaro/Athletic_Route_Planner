"""Builds the GATHO pixel font: Pixelify Sans (SIL OFL 1.1, no Reserved Font Name) from a pinned google/fonts
commit, fixed at weight 600, cut down to the characters the pixel type uses (the wordmark and stat numbers, blueprint
Phase 5b amendment 3), with tabular figures: Pixelify Sans has no `tnum` feature and its "1" is narrower than the
other digits, so "1" is widened to their advance and centred. Writes web/src/fonts/pixelify-gatho.woff2 and the
licence beside it.

    uv run --no-project --with fonttools --with brotli python web/scripts/subset_pixel_font.py
"""
import hashlib
import shutil
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

COMMIT = "8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5"   # google/fonts, 2026-03-12, ofl/pixelifysans
BASE = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl/pixelifysans/"
FILES = {
    "PixelifySans%5Bwght%5D.ttf": "9ba86cd010a4de309d263ceff8e8044092c9db7efda869620cb9ff1c4389e8a5",
    "OFL.txt": "b66ba46f511a851ab09998b5a5a9fdbb102545a3864cb993095e1745996873a7",
}
TEXT = "GATHO0123456789.,:+-−± "
WEIGHT = 600

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "fonts"
CACHE = ROOT.parent / "data" / "fonts" / "pixelifysans" / COMMIT[:12]


def fetch(name: str, sha: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name.replace("%5B", "[").replace("%5D", "]")
    if not path.exists():
        with urllib.request.urlopen(BASE + name, timeout=60) as r:
            path.write_bytes(r.read())
    got = hashlib.sha256(path.read_bytes()).hexdigest()
    if got != sha:
        sys.exit(f"{path.name}: sha256 {got}, expected {sha}")
    return path


def main() -> None:
    ttf = fetch("PixelifySans%5Bwght%5D.ttf", FILES["PixelifySans%5Bwght%5D.ttf"])
    licence = fetch("OFL.txt", FILES["OFL.txt"])

    font = instancer.instantiateVariableFont(TTFont(ttf), {"wght": WEIGHT})
    opts = subset.Options()
    opts.layout_features = ["kern", "ccmp", "locl"]
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
    target = OUT / "pixelify-gatho.woff2"
    font.save(target)
    shutil.copyfile(licence, OUT / "OFL-PixelifySans.txt")
    print(f"{target.relative_to(ROOT.parent)}: {target.stat().st_size} bytes, {len(font.getGlyphOrder())} glyphs, "
          f"weight {WEIGHT}, digits {width} units wide")


if __name__ == "__main__":
    main()
