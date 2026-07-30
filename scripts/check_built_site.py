#!/usr/bin/env python3
"""Check built routes, bilingual metadata, navigation, and live modules."""

from html.parser import HTMLParser
from pathlib import Path
import sys
from urllib.parse import unquote, urlparse


EXPECTED = {
    "index.html": ("zh-CN", "研究、工具、写作，以及正在发生的事。"),
    "projects/index.html": ("zh-CN", "项目"),
    "research/index.html": ("zh-CN", "研究"),
    "open-source/index.html": ("zh-CN", "开源"),
    "tools/index.html": ("zh-CN", "工具"),
    "writing/index.html": ("zh-CN", "写作"),
    "notes/index.html": ("zh-CN", "思考"),
    "logs/index.html": ("zh-CN", "日志"),
    "about/index.html": ("zh-CN", "关于"),
    "en/index.html": ("en-US", "Research, tools, writing, and work in progress."),
    "en/projects/index.html": ("en-US", "Projects"),
    "en/research/index.html": ("en-US", "Research"),
    "en/open-source/index.html": ("en-US", "Open Source"),
    "en/tools/index.html": ("en-US", "Tools"),
    "en/writing/index.html": ("en-US", "Writing"),
    "en/notes/index.html": ("en-US", "Notes"),
    "en/logs/index.html": ("en-US", "Logs"),
    "en/about/index.html": ("en-US", "About"),
}
DEFAULT_LANGUAGE_REDIRECT = "zh-cn/index.html"
EXTERNAL_HOSTS = {
    "functionhx.github.io",
    "github.com",
    "rebuttal-reader.tart-morel-3407.chatgpt.site",
}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.html_lang = ""
        self.ids: set[str] = set()
        self.classes: set[str] = set()
        self.hrefs: list[str] = []
        self.h1: list[str] = []
        self.hreflangs: set[str] = set()
        self._in_h1 = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "html":
            self.html_lang = values.get("lang", "") or ""
        if values.get("id"):
            self.ids.add(values["id"] or "")
        if values.get("class"):
            self.classes.update((values["class"] or "").split())
        if tag == "a" and values.get("href"):
            self.hrefs.append(values["href"] or "")
        if tag == "h1":
            self._in_h1 = True
            self.h1.append("")
        if (
            tag == "link"
            and values.get("rel") == "alternate"
            and values.get("hreflang")
        ):
            self.hreflangs.add(values["hreflang"] or "")

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1":
            self._in_h1 = False

    def handle_data(self, data: str) -> None:
        if self._in_h1:
            self.h1[-1] += " ".join(data.split())


def built_target(public: Path, page: Path, href: str) -> Path | None:
    parsed = urlparse(href)
    if parsed.scheme in {"http", "https", "mailto"}:
        if parsed.netloc in EXTERNAL_HOSTS:
            return None
        return None
    if parsed.scheme or href.startswith("#") or href.startswith("javascript:"):
        return None

    clean = unquote(parsed.path)
    if not clean:
        return None
    if clean.startswith("/"):
        target = public / clean.lstrip("/")
    else:
        target = page.parent / clean
    if target.suffix:
        return target
    return target / "index.html"


def main() -> int:
    public = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
    errors: list[str] = []

    for relative, (language, title) in EXPECTED.items():
        path = public / relative
        if not path.exists():
            errors.append(f"missing HTML page: {relative}")
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
        if "language-switch" not in parser.classes:
            errors.append(f"{relative}: missing language switch")
        if not {"zh-cn", "en"}.issubset(parser.hreflangs):
            errors.append(f"{relative}: missing bilingual hreflang links")

        for href in parser.hrefs:
            target = built_target(public, path, href)
            if target is not None and not target.exists():
                errors.append(f"{relative}: broken built link {href!r}")

        card_ids = {
            "kaggle-mini-card",
            "kmc-title",
            "kmc-time",
            "kmc-cv",
            "kmc-lb",
            "kmc-gap",
            "kmc-quota",
            "kmc-alert",
        }
        if relative in {"index.html", "en/index.html"}:
            if not card_ids.issubset(parser.ids):
                errors.append(f"{relative}: missing Kaggle monitor elements")
            if "https://functionhx.github.io/kaggle-agent/data/dashboard.json" not in html:
                errors.append(f"{relative}: missing Kaggle dashboard data source")
            if (
                "https://rebuttal-reader.tart-morel-3407.chatgpt.site/"
                not in parser.hrefs
            ):
                errors.append(f"{relative}: missing Rebuttal Reader launch link")
        elif card_ids & parser.ids:
            errors.append(f"{relative}: Kaggle monitor must appear only on the homepage")

    redirect = public / DEFAULT_LANGUAGE_REDIRECT
    if not redirect.exists():
        errors.append(f"missing default-language redirect: {DEFAULT_LANGUAGE_REDIRECT}")

    stylesheet_text = " ".join(
        path.read_text(encoding="utf-8") for path in public.rglob("*.css")
    )
    if 'data-theme="dark"' not in stylesheet_text and "data-theme=dark" not in stylesheet_text:
        errors.append("compiled CSS is missing dark-mode rules")
    if "prefers-reduced-motion" not in stylesheet_text:
        errors.append("compiled CSS is missing reduced-motion rules")
    if not (public / "favicon.svg").exists():
        errors.append("missing favicon")

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1

    print(
        "Validated bilingual hub routes, metadata, internal links, theme support, "
        "and homepage live modules."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
