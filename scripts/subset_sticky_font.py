#!/usr/bin/env python3
"""Build the self-hosted LXGW WenKai subset used by the article sticky notes.

Sticky notes (assets/css/sticky-notes.css) are written in a handwritten face. The author's
notes are known at build time, so this script writes

    assets/fonts/lxgw-wenkai/sticky-subset.woff2
    assets/fonts/lxgw-wenkai/sticky-subset.css

as the face "Function Sticky", containing the characters inside the built site's
<aside class="sticky-note"> elements plus every character the sticky-note interface itself
prints (assets/js/sticky-notes.js). A reader's own notes can contain anything; those
characters fall back to the jsDelivr "LXGW WenKai" slices that sticky-notes.js loads only
when the reader has notes, then to the system Kaiti. check_built_site.py reports how many
author-note characters are pending.

    bundle exec jekyll build && python3 scripts/subset_sticky_font.py

Needs fonttools and brotli (pip install fonttools brotli). The ~25 MB source font is
downloaded once into ~/.cache/functionhx-fonts/ and never committed. LXGW WenKai is under
the SIL Open Font License 1.1.
"""

from __future__ import annotations

import hashlib
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "_site"
OUT_DIR = ROOT / "assets" / "fonts" / "lxgw-wenkai"
FONT_NAME = "sticky-subset"
SOURCE_URL = "https://github.com/lxgw/LxgwWenKai/releases/latest/download/LXGWWenKai-Regular.ttf"
CACHE = Path.home() / ".cache" / "functionhx-fonts" / "LXGWWenKai-Regular.ttf"
INTERFACE = ROOT / "assets" / "js" / "sticky-notes.js"
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# Printable ASCII, CJK punctuation, full-width forms and the usual quotes and dashes.
ALWAYS = (
    set(range(0x20, 0x7F))
    | set(range(0x3000, 0x3040))
    | set(range(0xFF01, 0xFF5F))
    | {0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x00B7}
)


def is_cjk(char: str) -> bool:
    code = ord(char)
    return 0x2E80 <= code <= 0x9FFF or 0xF900 <= code <= 0xFAFF or 0xFF00 <= code <= 0xFFEF or 0x3000 <= code <= 0x303F


class StickyText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[tuple[str, bool]] = []
        self.codepoints: set[int] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in VOID_TAGS:
            return
        classes = set((dict(attrs).get("class") or "").split())
        self.stack.append((tag, "sticky-note" in classes))

    def handle_endtag(self, tag: str) -> None:
        while self.stack:
            if self.stack.pop()[0] == tag:
                break

    def handle_data(self, data: str) -> None:
        if any(sticky for _, sticky in self.stack):
            self.codepoints.update(ord(char) for char in data if is_cjk(char))


def sticky_codepoints(site: Path) -> set[int]:
    """CJK characters the built site shows inside author sticky notes."""
    parser = StickyText()
    for path in sorted(site.rglob("*.html")):
        text = path.read_text(encoding="utf-8")
        if "sticky-note" not in text:
            continue
        parser.feed(text)
        parser.stack.clear()
    return parser.codepoints


def interface_codepoints() -> set[int]:
    """CJK characters in the interface's string literals (comments are not shown to anyone)."""
    source = INTERFACE.read_text(encoding="utf-8")
    literals = re.findall(r'"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`', source)
    return {ord(char) for literal in literals for char in literal if is_cjk(char)}


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
    except ImportError:
        print("fonttools is required: pip install fonttools brotli", file=sys.stderr)
        return 2
    if not SITE.is_dir():
        print("build the site first: bundle exec jekyll build", file=sys.stderr)
        return 2

    used = sticky_codepoints(SITE)
    codepoints = used | interface_codepoints() | ALWAYS
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {SOURCE_URL} …")
        urllib.request.urlretrieve(SOURCE_URL, CACHE)

    font = TTFont(CACHE)
    options = subset.Options()
    options.flavor = "woff2"
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

    digest = hashlib.md5(woff2.read_bytes()).hexdigest()
    css = (
        "/* Generated by scripts/subset_sticky_font.py — do not edit. LXGW WenKai (SIL OFL 1.1),\n"
        "   only the characters the author's sticky notes and the sticky-note interface use. */\n"
        "@font-face {\n"
        '  font-family: "Function Sticky";\n'
        "  font-style: normal;\n"
        "  font-weight: 400;\n"
        "  font-display: swap;\n"
        f'  src: url("{FONT_NAME}.woff2?v={digest}") format("woff2");\n'
        f"  unicode-range: {unicode_range(covered & codepoints)};\n"
        "}\n"
    )
    (OUT_DIR / f"{FONT_NAME}.css").write_text(css, encoding="utf-8")
    print(
        f"{len(used)} author-note characters ({len(covered & codepoints)} glyphs with the interface) -> "
        f"{woff2.relative_to(ROOT)} ({woff2.stat().st_size} B)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
