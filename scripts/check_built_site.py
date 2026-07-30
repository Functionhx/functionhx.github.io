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
    "/projects/",
    "/en/projects/",
    "/research/",
    "/en/research/",
    "/tools/",
    "/en/tools/",
    "/writing/",
    "/en/writing/",
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
        parser.feed(path.read_text(encoding="utf-8"))
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

    for route in ("/", "/en/"):
        parser = parsed_pages.get(route)
        if not parser:
            continue
        heading = " ".join(" ".join(parser.h1_text).split())
        if "Yuchen Fan" not in heading:
            errors.append(f"{route}: main identity heading is missing")
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
    for label in ("关于", "项目", "研究", "工具", "写作", "思考", "日志", "EN"):
        if label not in chinese_nav:
            errors.append(f"/: navigation label {label!r} missing")
    for label in ("about", "projects", "research", "tools", "writing", "notes", "logs", "中"):
        if label not in english_nav:
            errors.append(f"/en/: navigation label {label!r} missing")

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
