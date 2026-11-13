"""Build public/fonts/instrument-sans-amp.woff2: an ampersand-only face.

Enoma's own pages set display text in Fraunces, whose "&" is a decorative
italic-style form. public/styles/enoma.css puts an "Enoma Amp" @font-face
(unicode-range: U+0026) first in --font-display, so the browser draws only
"&" from this file and everything else from Fraunces.

Source: Instrument Sans (SIL Open Font License 1.1) from the google/fonts
repository, pinned to a commit so the output is reproducible. The variable
font is pinned to wght=600, wdth=100, then subset to U+0026 and written as
WOFF2.

Run (needs Python 3 and fonttools with brotli):
    pip install "fonttools[woff]==4.55.3"
    python scripts/build-amp-font.py
"""
import io
import sys
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

COMMIT = "0b58fb370093f9a9f4ff785d94405710b79de67c"
SRC = (
    "https://raw.githubusercontent.com/google/fonts/"
    f"{COMMIT}/ofl/instrumentsans/InstrumentSans%5Bwdth,wght%5D.ttf"
)
OUT = Path(__file__).resolve().parent.parent / "public" / "fonts" / "instrument-sans-amp.woff2"


def main() -> int:
    with urllib.request.urlopen(SRC) as r:
        data = r.read()
    font = TTFont(io.BytesIO(data))
    font = instancer.instantiateVariableFont(font, {"wght": 600, "wdth": 100})

    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = []     # no OpenType features needed for one glyph
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]  # keep copyright + OFL licence strings
    opts.name_languages = [0x409]
    opts.notdef_outline = False
    opts.hinting = False
    opts.desubroutinize = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[0x26])
    sub.subset(font)

    cmap = font.getBestCmap()
    if set(cmap) != {0x26}:
        print(f"unexpected cmap after subset: {sorted(cmap)}", file=sys.stderr)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(str(OUT))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
