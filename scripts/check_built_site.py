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
    "/blog/2026/embodied-ai-control-story/",
    "/en/blog/2026/embodied-ai-control-story/",
    "/blog/2026/batch-lio/",
    "/en/blog/2026/batch-lio/",
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
    "/tools/kaggle-agent/",
    "/en/tools/kaggle-agent/",
    "/notes/",
    "/en/notes/",
    "/logs/",
    "/en/logs/",
    "/spark/",
    "/en/spark/",
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
        if 'role="contentinfo"' in rendered_html:
            errors.append(f"{route}: removed global footer still renders")

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
        html = route_file(site, route).read_text(encoding="utf-8")
        if "kaggle-mini-card" in html:
            errors.append(f"{route}: Kaggle monitor must not render on the homepage")
        if "https://functionhx.github.io/kaggle-agent/data/dashboard.json" in html:
            errors.append(f"{route}: Kaggle monitor script must not load on the homepage")

    for route in ("/tools/kaggle-agent/", "/en/tools/kaggle-agent/"):
        parser = parsed_pages.get(route)
        if not parser:
            continue
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

    for route in ("/spark/", "/en/spark/"):
        parser = parsed_pages.get(route)
        if not parser:
            continue
        missing_writer_ids = {
            "site-spark-create",
            "site-spark-writer",
            "site-spark-writer-title-zh",
            "site-spark-writer-title-en",
            "site-spark-writer-body-zh",
            "site-spark-writer-body-en",
            "site-spark-writer-publish",
        }.difference(parser.ids)
        if missing_writer_ids:
            errors.append(
                f"{route}: direct Spark writer controls missing "
                f"{sorted(missing_writer_ids)}"
            )

    article_sources = {
        "/blog/2026/embodied-ai-control-story/": (
            "https://zhuanlan.zhihu.com/p/2048053637985859286"
        ),
        "/en/blog/2026/embodied-ai-control-story/": (
            "https://zhuanlan.zhihu.com/p/2048053637985859286"
        ),
        "/blog/2026/batch-lio/": (
            "https://bbs.robomaster.com/article/1936372?source=1"
        ),
        "/en/blog/2026/batch-lio/": (
            "https://bbs.robomaster.com/article/1936372?source=1"
        ),
    }
    for route, source in article_sources.items():
        parser = parsed_pages.get(route)
        if parser and source not in parser.links:
            errors.append(f"{route}: source publication link missing")
        if not parser:
            continue
        html = route_file(site, route).read_text(encoding="utf-8")
        if route.startswith("/en/"):
            if "Created on" not in html:
                errors.append(f"{route}: English publication date label missing")
            expected_comment_language = "en"
            expected_comment_heading = ">Comments</h2>"
        else:
            if "发布于" not in html:
                errors.append(f"{route}: Chinese publication date label missing")
            if "Created on" in html:
                errors.append(f"{route}: English publication date label leaked")
            expected_comment_language = "zh-CN"
            expected_comment_heading = ">评论</h2>"
        for expected_comment_markup in (
            '"Functionhx/functionhx.github.io"',
            f"'data-lang': \"{expected_comment_language}\"",
            expected_comment_heading,
        ):
            if expected_comment_markup not in html:
                errors.append(
                    f"{route}: Giscus markup {expected_comment_markup!r} missing"
                )

    required_social_links = {
        "https://functionhx.github.io/",
        "mailto:functionhx@gmail.com",
        "https://github.com/Functionhx",
        "https://www.kaggle.com/funcnano",
        "https://www.linkedin.com/in/zaizai-fan-152611414",
        "https://huggingface.co/Func-nano",
    }
    for route in ("/", "/en/"):
        parser = parsed_pages.get(route)
        if not parser:
            continue
        missing_editor_ids = {
            "site-inline-editor-toggle",
            "site-inline-editor",
            "site-inline-editor-body",
            "site-inline-editor-commit",
        }.difference(parser.ids)
        if missing_editor_ids:
            errors.append(f"{route}: inline editor controls missing {sorted(missing_editor_ids)}")
        external_editors = {
            "https://app.pagescms.org/",
            "https://github.dev/Functionhx/functionhx.github.io",
        }.intersection(parser.links)
        if external_editors:
            errors.append(f"{route}: external editor link leaked {sorted(external_editors)}")
        missing_links = required_social_links.difference(parser.links)
        if missing_links:
            errors.append(f"{route}: missing social links {sorted(missing_links)}")

    for asset in (
        "assets/css/inline-editor.css",
        "assets/js/inline-editor.js",
        "assets/css/spark-writer.css",
        "assets/js/spark-writer.js",
    ):
        if not (site / asset).is_file():
            errors.append(f"/{asset}: authoring asset missing")

    chinese_nav = " ".join(parsed_pages.get("/", PageParser()).nav_text)
    english_nav = " ".join(parsed_pages.get("/en/", PageParser()).nav_text)
    for label in (
        "关于",
        "博客",
        "论文",
        "项目",
        "仓库",
        "简历",
        "人物",
        "动态",
        "工具",
        "闪耀",
        "EN",
    ):
        if label not in chinese_nav:
            errors.append(f"/: navigation label {label!r} missing")
    for label in (
        "about",
        "blog",
        "publications",
        "projects",
        "repositories",
        "CV",
        "people",
        "news",
        "tools",
        "Spark",
        "中",
    ):
        if label not in english_nav:
            errors.append(f"/en/: navigation label {label!r} missing")
    if "更多" in chinese_nav:
        errors.append("/: collapsed more navigation must not render")
    if "more" in english_nav:
        errors.append("/en/: collapsed more navigation must not render")
    for label in ("教学", "书架", "思考", "日志"):
        if label in chinese_nav:
            errors.append(f"/: removed navigation label {label!r} still renders")
    for label in ("teaching", "bookshelf", "thoughts", "logs"):
        if label in english_nav:
            errors.append(f"/en/: removed navigation label {label!r} still renders")

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
