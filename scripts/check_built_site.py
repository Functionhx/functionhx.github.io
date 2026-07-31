#!/usr/bin/env python3
"""Check generated routes, bilingual metadata, controls, and internal links."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit


EXPECTED_ROUTES = (
    "/",
    "/en/",
    "/blog/",
    "/en/blog/",
    "/publications/",
    "/en/publications/",
    "/projects/",
    "/en/projects/",
    "/repositories/",
    "/en/repositories/",
    "/cv/",
    "/en/cv/",
    "/teaching/",
    "/en/teaching/",
    "/people/",
    "/en/people/",
    "/more/",
    "/en/more/",
    "/books/",
    "/en/books/",
    "/tools/",
    "/en/tools/",
    "/notes/",
    "/en/notes/",
    "/logs/",
    "/en/logs/",
    "/news/",
    "/en/news/",
)
SKIP_SCHEMES = {"mailto", "tel", "javascript", "data"}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.html_lang = ""
        self.ids: set[str] = set()
        self.links: list[str] = []
        self.alternates: dict[str, str] = {}
        self.in_h1 = False
        self.h1_text: list[str] = []
        self.in_nav = False
        self.nav_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "html":
            self.html_lang = attributes.get("lang") or ""
        if attributes.get("id"):
            self.ids.add(attributes["id"])
        if tag == "a" and attributes.get("href"):
            self.links.append(attributes["href"])
        if tag == "link" and attributes.get("rel") == "alternate":
            language = attributes.get("hreflang")
            href = attributes.get("href")
            if language and href:
                self.alternates[language] = href
        if tag == "h1":
            self.in_h1 = True
        if tag == "nav" and attributes.get("id") == "navbar":
            self.in_nav = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1":
            self.in_h1 = False
        if tag == "nav":
            self.in_nav = False

    def handle_data(self, data: str) -> None:
        if self.in_h1:
            self.h1_text.append(data)
        if self.in_nav:
            self.nav_text.append(data)


def route_file(site: Path, route: str) -> Path:
    clean = unquote(route.split("?", 1)[0].split("#", 1)[0])
    relative = clean.lstrip("/")
    if not relative:
        return site / "index.html"
    candidate = site / relative
    if clean.endswith("/"):
        return candidate / "index.html"
    if candidate.suffix:
        return candidate
    if candidate.is_file():
        return candidate
    html_candidate = candidate.with_suffix(".html")
    if html_candidate.exists():
        return html_candidate
    return candidate / "index.html"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_built_site.py SITE_DIRECTORY", file=sys.stderr)
        return 2

    site = Path(sys.argv[1]).resolve()
    errors: list[str] = []
    parsed_pages: dict[str, PageParser] = {}

    for route in EXPECTED_ROUTES:
        path = route_file(site, route)
        if not path.is_file():
            errors.append(f"{route}: missing generated file {path}")
            continue
        parser = PageParser()
        rendered_html = path.read_text(encoding="utf-8")
        parser.feed(rendered_html)
        parsed_pages[route] = parser

        expected_language = "en" if route.startswith("/en/") else "zh-CN"
        if parser.html_lang != expected_language:
            errors.append(
                f"{route}: expected html lang {expected_language!r}, "
                f"found {parser.html_lang!r}"
            )
        for required_id in ("navbar", "search-toggle", "light-toggle"):
            if required_id not in parser.ids:
                errors.append(f"{route}: missing required control #{required_id}")
        if not {"zh-CN", "en", "x-default"}.issubset(parser.alternates):
            errors.append(f"{route}: incomplete hreflang alternates {parser.alternates}")
        if expected_language == "zh-CN" and "Yuchen Fan" in rendered_html:
            errors.append(f"{route}: English identity leaked into the Chinese page")

    for route in ("/", "/en/"):
        parser = parsed_pages.get(route)
        if not parser:
            continue
        heading = " ".join(" ".join(parser.h1_text).split())
        expected_identity = "Yuchen Fan" if route == "/en/" else "樊宇琛"
        if expected_identity not in heading:
            errors.append(
                f"{route}: expected identity heading {expected_identity!r}, found {heading!r}"
            )
        for required_id in (
            "kaggle-mini-card",
            "kmc-title",
            "kmc-time",
            "kmc-cv",
            "kmc-lb",
            "kmc-gap",
            "kmc-quota",
            "kmc-alert",
        ):
            if required_id not in parser.ids:
                errors.append(f"{route}: missing Kaggle element #{required_id}")
        html = route_file(site, route).read_text(encoding="utf-8")
        if "https://functionhx.github.io/kaggle-agent/data/dashboard.json" not in html:
            errors.append(f"{route}: Kaggle data endpoint missing from generated HTML")

    chinese_nav = " ".join(parsed_pages.get("/", PageParser()).nav_text)
    english_nav = " ".join(parsed_pages.get("/en/", PageParser()).nav_text)
    for label in ("关于", "博客", "论文", "项目", "仓库", "简历", "教学", "人物", "更多", "EN"):
        if label not in chinese_nav:
            errors.append(f"/: navigation label {label!r} missing")
    for label in ("about", "blog", "publications", "projects", "repositories", "CV", "teaching", "people", "more", "中"):
        if label not in english_nav:
            errors.append(f"/en/: navigation label {label!r} missing")

    for route in ("/projects/", "/en/projects/"):
        path = route_file(site, route)
        if path.is_file():
            html = path.read_text(encoding="utf-8")
            if html.count("card h-100 hoverable") != 9:
                errors.append(f"{route}: expected exactly nine original-style project cards")

    for route in ("/publications/", "/en/publications/"):
        path = route_file(site, route)
        if path.is_file():
            html = path.read_text(encoding="utf-8")
            if "PhysRev.47.777" not in html and "Can Quantum-Mechanical Description" not in html:
                errors.append(f"{route}: bibliography did not render")

    banned_editorial_phrases = (
        "原版占位",
        "原版节奏",
        "完整复刻",
        "original demo",
        "original demo placeholder",
        "original al-folio demo",
    )
    for route in EXPECTED_ROUTES:
        path = route_file(site, route)
        if not path.is_file():
            continue
        html = path.read_text(encoding="utf-8").lower()
        for phrase in banned_editorial_phrases:
            if phrase.lower() in html:
                errors.append(f"{route}: editorial phrase {phrase!r} leaked into HTML")

    for route, locale in (("/repositories/", "cn"), ("/en/repositories/", "en")):
        path = route_file(site, route)
        if path.is_file():
            html = path.read_text(encoding="utf-8")
            if "## GitHub" in html or 'class="language-plaintext highlighter-rouge"' in html:
                errors.append(f"{route}: repository template rendered as source code")
            if f"locale={locale}" not in html:
                errors.append(f"{route}: expected repository-card locale {locale!r}")

    for html_path in sorted(site.rglob("*.html")):
        parser = PageParser()
        parser.feed(html_path.read_text(encoding="utf-8"))
        page_route = "/" + html_path.relative_to(site).as_posix()
        for href in parser.links:
            split = urlsplit(href)
            if split.scheme in SKIP_SCHEMES or split.netloc:
                continue
            if not split.path or split.path.startswith("#"):
                continue
            if split.path.startswith("/"):
                target_route = split.path
            else:
                base = html_path.parent.relative_to(site)
                target_route = "/" + (base / split.path).as_posix()
            target = route_file(site, target_route)
            if not target.exists():
                errors.append(f"{page_route}: broken internal link {href!r}")

    rebuttal_url = "https://rebuttal-reader.tart-morel-3407.chatgpt.site/"
    for route in ("/tools/", "/en/tools/"):
        parser = parsed_pages.get(route)
        if parser and rebuttal_url not in parser.links:
            errors.append(f"{route}: Rebuttal Reader link missing")

    if errors:
        print("Built-site validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Built-site validation passed: {len(EXPECTED_ROUTES)} routes and all internal links.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
