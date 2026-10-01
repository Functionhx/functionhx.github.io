#!/usr/bin/env python3
"""Build a Font Awesome subset containing only the icons this site uses.

The full Font Awesome 7 bundle is ~75 KB of render-blocking CSS plus ~240 KB of fonts
(the brands font alone is 108 KB and downloads as soon as one social icon is on screen).
The site uses a few dozen icons, so this script writes

    assets/third-party/fontawesome-<version>/css/subset.min.css
    assets/third-party/fontawesome-<version>/webfonts/fa-*-subset.woff2

from the untouched npm files next to them, keeping every non-icon rule (sizes, animations,
stacking, @font-face) and only the icon rules that are used.

Icons are collected from the sources (assets/js, _includes, _layouts, content, _data) and,
when present, the built site (_site HTML and JS, which covers icons emitted by the theme gem).
check_built_site.py fails when a built page or script references an icon missing from the
subset; rerun this script after a build to fix that:

    bundle exec jekyll build && python3 scripts/subset_fontawesome.py

Needs fonttools and brotli (pip install fonttools brotli); CI does not run this script, the
generated files are committed.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
VERSION = "7.2.0"
FA_DIR = ROOT / "assets" / "third-party" / f"fontawesome-{VERSION}"
SOURCE_CSS = FA_DIR / "css" / "all.min.css"
SUBSET_CSS = FA_DIR / "css" / "subset.min.css"
FONTS = ("fa-brands-400", "fa-regular-400", "fa-solid-900")
# Icons that only appear in strings assembled at runtime, if any, go here.
EXTRA_ICONS: set[str] = set()

SCAN_GLOBS = (
    "assets/js/**/*.js",
    "_includes/**/*.liquid",
    "_layouts/**/*.liquid",
    "_pages/**/*.md",
    "_posts/**/*.md",
    "_projects/**/*.md",
    "_news/**/*.md",
    "_data/**/*.yml",
    "_config.yml",
    "_site/**/*.html",
    "_site/assets/js/**/*.js",
)
ICON_CLASS = re.compile(r"(?<![\w-])fa-([a-z0-9]+(?:-[a-z0-9]+)*)")
ICON_RULE = re.compile(r'^((?:\.fa-[a-z0-9-]+,?)+)\{--fa:"([^"]+)"\}$')


def split_rules(css: str) -> list[str]:
    """Split minified CSS into top-level rules (at-rules keep their nested blocks)."""
    rules, depth, start, quote = [], 0, 0, ""
    for index, char in enumerate(css):
        if quote:
            if char == quote and css[index - 1] != "\\":
                quote = ""
            continue
        if char in "\"'":
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                rules.append(css[start : index + 1])
                start = index + 1
    tail = css[start:].strip()
    if tail:
        rules.append(tail)
    return rules


def used_names(icon_names: set[str]) -> set[str]:
    names: set[str] = set(EXTRA_ICONS)
    for pattern in SCAN_GLOBS:
        for path in ROOT.glob(pattern):
            if "third-party" in path.parts or not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            names.update(name for name in ICON_CLASS.findall(text) if name in icon_names)
    return names


def codepoint(value: str) -> int:
    """CSS string content: "\\f00c" (hex escape), "\\+" (escaped literal) or "A" (literal)."""
    if not value.startswith("\\"):
        return ord(value)
    escaped = value[1:].strip()
    return int(escaped, 16) if re.fullmatch(r"[0-9a-fA-F]{1,6}", escaped) else ord(escaped)


def main() -> int:
    try:
        from fontTools import subset
    except ImportError:
        print("fonttools is required: pip install fonttools brotli", file=sys.stderr)
        return 2

    css = SOURCE_CSS.read_text(encoding="utf-8")
    header = css[: css.index("*/") + 2] if css.startswith("/*") else ""
    rules = split_rules(css[len(header) :])

    icon_rules = {}
    for rule in rules:
        match = ICON_RULE.match(rule)
        if match:
            for selector in match.group(1).rstrip(",").split(","):
                icon_rules[selector.removeprefix(".fa-")] = match.group(2)
    used = used_names(set(icon_rules))
    if not used:
        print("no Font Awesome icons found; refusing to write an empty subset", file=sys.stderr)
        return 1

    kept, codepoints = [], set()
    for rule in rules:
        match = ICON_RULE.match(rule)
        if not match:
            if "fa-v4compatibility" in rule:
                continue
            for font in FONTS:
                rule = rule.replace(f"{font}.woff2", f"{font}-subset.woff2")
            kept.append(rule)
            continue
        selectors = [s for s in match.group(1).rstrip(",").split(",") if s.removeprefix(".fa-") in used]
        if selectors:
            kept.append(f'{",".join(selectors)}{{--fa:"{match.group(2)}"}}')
            codepoints.add(codepoint(match.group(2)))

    # Glyphs differ per style; subsetting every font to the union keeps the code simple and
    # costs a few hundred bytes.
    for font in FONTS:
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.notdef_outline = True
        loaded = subset.load_font(str(FA_DIR / "webfonts" / f"{font}.woff2"), options)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=sorted(codepoints | {0x20}))
        subsetter.subset(loaded)
        loaded.recalcTimestamp = False  # deterministic output keeps the ?v= hash stable
        subset.save_font(loaded, str(FA_DIR / "webfonts" / f"{font}-subset.woff2"), options)

    output = header + "".join(kept)
    # Font URLs inside the CSS carry a content hash so the year-long immutable cache stays correct.
    for font in FONTS:
        data = (FA_DIR / "webfonts" / f"{font}-subset.woff2").read_bytes()
        digest = hashlib.sha256(data).hexdigest()[:12]
        output = output.replace(f"{font}-subset.woff2)", f"{font}-subset.woff2?v={digest})")
    SUBSET_CSS.write_text(output + "\n", encoding="utf-8")

    sizes = ", ".join(
        f"{font}: {(FA_DIR / 'webfonts' / f'{font}-subset.woff2').stat().st_size} B" for font in FONTS
    )
    print(f"{len(used)} icons -> {SUBSET_CSS.relative_to(ROOT)} ({len(output)} B); {sizes}")

    # The stylesheet URL in _config.yml carries the CSS hash for the same reason.
    config_path = ROOT / "_config.yml"
    config = config_path.read_text(encoding="utf-8")
    css_url = f"/assets/third-party/fontawesome-{VERSION}/css/subset.min.css"
    css_hash = hashlib.sha256((output + "\n").encode()).hexdigest()[:12]
    updated, count = re.subn(
        rf'css: "{re.escape(css_url)}\?v=[0-9a-f]+"', f'css: "{css_url}?v={css_hash}"', config
    )
    if count != 1:
        print(f"_config.yml: fontawesome css url {css_url}?v=… not found, update it by hand", file=sys.stderr)
        return 1
    config_path.write_text(updated, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
