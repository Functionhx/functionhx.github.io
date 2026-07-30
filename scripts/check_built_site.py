#!/usr/bin/env python3
"""Check that the production build contains only the intended site shell."""

from html.parser import HTMLParser
from pathlib import Path
import sys


EXPECTED = {
    "index.html": ("zh-CN", "首页", {"栏目", "首页", "项目", "研究", "开源", "笔记", "关于"}),
    "projects/index.html": ("zh-CN", "项目", {"栏目", "首页", "项目", "研究", "开源", "笔记", "关于"}),
    "research/index.html": ("zh-CN", "研究", {"栏目", "首页", "项目", "研究", "开源", "笔记", "关于"}),
    "open-source/index.html": ("zh-CN", "开源", {"栏目", "首页", "项目", "研究", "开源", "笔记", "关于"}),
    "notes/index.html": ("zh-CN", "笔记", {"栏目", "首页", "项目", "研究", "开源", "笔记", "关于"}),
    "about/index.html": ("zh-CN", "关于", {"栏目", "首页", "项目", "研究", "开源", "笔记", "关于"}),
    "en/index.html": ("en-US", "Home", {"Sections", "Home", "Projects", "Research", "Open Source", "Notes", "About"}),
    "en/projects/index.html": ("en-US", "Projects", {"Sections", "Home", "Projects", "Research", "Open Source", "Notes", "About"}),
    "en/research/index.html": ("en-US", "Research", {"Sections", "Home", "Projects", "Research", "Open Source", "Notes", "About"}),
    "en/open-source/index.html": ("en-US", "Open Source", {"Sections", "Home", "Projects", "Research", "Open Source", "Notes", "About"}),
    "en/notes/index.html": ("en-US", "Notes", {"Sections", "Home", "Projects", "Research", "Open Source", "Notes", "About"}),
    "en/about/index.html": ("en-US", "About", {"Sections", "Home", "Projects", "Research", "Open Source", "Notes", "About"}),
}

DEFAULT_LANGUAGE_REDIRECT = "zh-cn/index.html"

class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.html_lang = ""
        self.ids: set[str] = set()
        self.classes: set[str] = set()
        self.h1: list[str] = []
        self.hreflangs: set[str] = set()
        self.text: list[str] = []
        self._in_h1 = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "html":
            self.html_lang = values.get("lang", "") or ""
        if values.get("id"):
            self.ids.add(values["id"] or "")
        if values.get("class"):
            self.classes.update((values["class"] or "").split())
        if tag == "h1":
            self._in_h1 = True
            self.h1.append("")
        if tag == "link" and values.get("rel") == "alternate" and values.get("hreflang"):
            self.hreflangs.add(values["hreflang"] or "")

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1":
            self._in_h1 = False

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if not value:
            return
        self.text.append(value)
        if self._in_h1:
            self.h1[-1] += value


def main() -> int:
    public = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
    errors: list[str] = []

    actual_html = {
        str(path.relative_to(public))
        for path in public.rglob("*.html")
    }
    expected_html = set(EXPECTED) | {DEFAULT_LANGUAGE_REDIRECT}
    for relative in sorted(expected_html - actual_html):
        errors.append(f"missing HTML page: {relative}")
    for relative in sorted(actual_html - expected_html):
        errors.append(f"unexpected HTML page: {relative}")

    for relative, (language, title, required_labels) in EXPECTED.items():
        path = public / relative
        if not path.exists():
            continue

        html = path.read_text(encoding="utf-8")
        parser = PageParser()
        parser.feed(html)

        if parser.html_lang != language:
            errors.append(f"{relative}: expected html lang={language}")
        if parser.h1 != [title]:
            errors.append(f"{relative}: expected one h1 with text {title!r}")
        if "theme-toggle" not in parser.ids:
            errors.append(f"{relative}: missing theme toggle")
        if not required_labels.issubset(set(parser.text)):
            missing = sorted(required_labels - set(parser.text))
            errors.append(f"{relative}: missing interface labels {missing}")
        if not {"zh-cn", "en"}.issubset(parser.hreflangs):
            errors.append(f"{relative}: missing bilingual hreflang links")
        if "language-switch" not in parser.classes:
            errors.append(f"{relative}: missing language switch")

    redirect = public / DEFAULT_LANGUAGE_REDIRECT
    if redirect.exists():
        redirect_html = redirect.read_text(encoding="utf-8")
        if 'url=https://functionhx.github.io/' not in redirect_html:
            errors.append(f"{DEFAULT_LANGUAGE_REDIRECT}: invalid default-language redirect")

    stylesheet_text = " ".join(
        path.read_text(encoding="utf-8")
        for path in public.rglob("*.css")
    )
    if 'data-theme="dark"' not in stylesheet_text and "data-theme=dark" not in stylesheet_text:
        errors.append("compiled CSS is missing dark-mode rules")
    if not (public / "favicon.svg").exists():
        errors.append("missing neutral favicon")

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1

    print("Validated the 12-page bilingual light/dark site shell.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
