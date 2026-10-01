#!/usr/bin/env python3
"""Build the self-hosted Noto Serif SC subset used for headings.

Headings and titles use Noto Serif SC 500. Loaded from jsDelivr as ~100 unicode-range slices,
a first visit downloads ~10 slices (~380 KB) for what is only a few hundred distinct characters.
This script writes

    assets/fonts/noto-serif-sc/noto-serif-sc-500-subset.woff2
    assets/fonts/noto-serif-sc/noto-serif-sc-500-subset.css

containing exactly the characters the built site renders in the serif. The subset's
@font-face is declared after the jsDelivr slices (see _layouts/default.liquid), and browsers
pick the last declared face whose unicode-range covers a character, so:

- characters in the subset come from this one same-origin file;
- characters added since the last run (a new post title) still render, from the jsDelivr
  slices, until the script is run again. check_built_site.py reports how many are pending.

    bundle exec jekyll build && python3 scripts/subset_serif_font.py

Needs fonttools and brotli (pip install fonttools brotli). The ~25 MB variable source font is
downloaded once into ~/.cache/functionhx-fonts/ and never committed.
"""

from __future__ import annotations

import hashlib
from html.parser import HTMLParser
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "_site"
OUT_DIR = ROOT / "assets" / "fonts" / "noto-serif-sc"
FONT_NAME = "noto-serif-sc-500-subset"
SOURCE_URL = "https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf"
CACHE = Path.home() / ".cache" / "functionhx-fonts" / "NotoSerifSC[wght].ttf"
WEIGHT = 500

# Elements rendered in var(--function-serif) (function.css, function-home.css, blog-feed.css).
# Kept deliberately generous: an extra glyph costs ~200 bytes, a missing one costs a slice.
SERIF_TAGS = {"h1", "h2", "h3"}
SERIF_CLASSES = {
    "post-title",
    "function-directory-title",
    "function-wordmark",
    "function-mobile-brand",
    "writing-topics",
}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# CJK punctuation and full-width forms are always included: titles use them constantly.
ALWAYS = set(range(0x3000, 0x3040)) | set(range(0xFF01, 0xFF5F)) | {0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x00B7}


def is_cjk(char: str) -> bool:
    code = ord(char)
    return 0x2E80 <= code <= 0x9FFF or 0xF900 <= code <= 0xFAFF or 0xFF00 <= code <= 0xFFEF or 0x3000 <= code <= 0x303F


class SerifText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[tuple[str, bool]] = []
        self.codepoints: set[int] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in VOID_TAGS:
            return
        classes = set((dict(attrs).get("class") or "").split())
        self.stack.append((tag, tag in SERIF_TAGS or bool(classes & SERIF_CLASSES)))

    def handle_endtag(self, tag: str) -> None:
        while self.stack:
            if self.stack.pop()[0] == tag:
                break

    def handle_data(self, data: str) -> None:
        if any(serif for _, serif in self.stack):
            self.codepoints.update(ord(char) for char in data if is_cjk(char))


def serif_codepoints(site: Path) -> set[int]:
    parser = SerifText()
    for path in sorted(site.rglob("*.html")):
        parser.feed(path.read_text(encoding="utf-8"))
        parser.stack.clear()
    return parser.codepoints


def unicode_range(codepoints: set[int]) -> str:
    ranges, ordered = [], sorted(codepoints)
    start = previous = ordered[0]
    for code in ordered[1:] + [None]:
        if code is not None and code == previous + 1:
            previous = code
            continue
        ranges.append(f"U+{start:x}" if start == previous else f"U+{start:x}-{previous:x}")
        if code is not None:
            start = previous = code
    return ",".join(ranges)


def main() -> int:
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
        from fontTools.varLib import instancer
    except ImportError:
        print("fonttools is required: pip install fonttools brotli", file=sys.stderr)
        return 2
    if not SITE.is_dir():
        print("build the site first: bundle exec jekyll build", file=sys.stderr)
        return 2

    used = serif_codepoints(SITE)
    codepoints = used | ALWAYS
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {SOURCE_URL} …")
        urllib.request.urlretrieve(SOURCE_URL, CACHE)

    font = instancer.instantiateVariableFont(TTFont(CACHE), {"wght": WEIGHT})
    options = subset.Options()
    options.flavor = "woff2"
    # Only horizontal features: "*" would also keep vertical forms and the JP/KR/TC locl
    # alternates, which nearly doubles the glyph count (and the file) for nothing.
    options.layout_features = ["kern", "palt", "halt", "ccmp"]
    options.hinting = False
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=sorted(codepoints))
    subsetter.subset(font)
    covered = set(font.getBestCmap())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    woff2 = OUT_DIR / f"{FONT_NAME}.woff2"
    font.recalcTimestamp = False  # deterministic output, so an unchanged subset keeps its cache URL
    subset.save_font(font, str(woff2), options)

    # Same digest as Jekyll's bust_file_cache, so the <link rel="preload"> in default.liquid
    # requests exactly the URL this CSS uses (otherwise the font would download twice).
    digest = hashlib.md5(woff2.read_bytes()).hexdigest()
    css = (
        "/* Generated by scripts/subset_serif_font.py — do not edit. Declared after the jsDelivr\n"
        "   slices so these characters come from this file; anything else falls back to the slices. */\n"
        "@font-face {\n"
        '  font-family: "Noto Serif SC";\n'
        "  font-style: normal;\n"
        f"  font-weight: {WEIGHT};\n"
        "  font-display: swap;\n"
        f'  src: url("{FONT_NAME}.woff2?v={digest}") format("woff2");\n'
        f"  unicode-range: {unicode_range(covered & codepoints)};\n"
        "}\n"
    )
    (OUT_DIR / f"{FONT_NAME}.css").write_text(css, encoding="utf-8")
    print(
        f"{len(used)} serif characters ({len(covered & codepoints)} glyphs with punctuation) -> "
        f"{woff2.relative_to(ROOT)} ({woff2.stat().st_size} B)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
