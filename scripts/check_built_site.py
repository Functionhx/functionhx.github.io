#!/usr/bin/env python3
"""Check generated routes, bilingual metadata, controls, and internal links."""

from __future__ import annotations

from html.parser import HTMLParser
import json
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
    "/search/",
    "/en/search/",
)
SKIP_SCHEMES = {"mailto", "tel", "javascript", "data"}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.html_lang = ""
        self.html_nav_density = ""
        self.ids: set[str] = set()
        self.links: list[str] = []
        self.alternates: dict[str, str] = {}
        self.in_h1 = False
        self.in_title = False
        self.h1_text: list[str] = []
        self.title_text: list[str] = []
        self.in_nav = False
        self.nav_text: list[str] = []
        self.nav_translation_keys: list[str] = []
        self.active_nav_translation_keys: list[str] = []
        self.settings_visibility: dict[str, bool] = {}
        self.current_nav_item_active = False
        self.has_stable_nav_container = False
        self.has_title_brand = False
        self.inline_editor_source_path = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        if tag == "html":
            self.html_lang = attributes.get("lang") or ""
            self.html_nav_density = attributes.get("data-nav-density") or ""
        if attributes.get("id"):
            self.ids.add(attributes["id"])
        nav_translation_key = attributes.get("data-nav-translation-key")
        if nav_translation_key:
            self.nav_translation_keys.append(nav_translation_key)
            if self.current_nav_item_active:
                self.active_nav_translation_keys.append(nav_translation_key)
        if "navbar-container-stable" in classes:
            self.has_stable_nav_container = True
        if "navbar-brand" in classes and "title" in classes:
            self.has_title_brand = True
        if attributes.get("id") == "site-inline-editor":
            self.inline_editor_source_path = attributes.get("data-source-path") or ""
        if self.in_nav and tag == "li":
            self.current_nav_item_active = "active" in classes
        if "data-section-toggle" in attributes:
            translation_key = attributes.get("data-translation-key")
            if translation_key:
                self.settings_visibility[translation_key] = (
                    attributes.get("data-initial-visible") == "true"
                )
        if tag == "a" and attributes.get("href"):
            self.links.append(attributes["href"])
        if tag == "link" and attributes.get("rel") == "alternate":
            language = attributes.get("hreflang")
            href = attributes.get("href")
            if language and href:
                self.alternates[language] = href
        if tag == "h1":
            self.in_h1 = True
        if tag == "title":
            self.in_title = True
        if tag == "nav" and attributes.get("id") == "navbar":
            self.in_nav = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1":
            self.in_h1 = False
        if tag == "title":
            self.in_title = False
        if tag == "nav":
            self.in_nav = False
        if tag == "li" and self.in_nav:
            self.current_nav_item_active = False

    def handle_data(self, data: str) -> None:
        if self.in_h1:
            self.h1_text.append(data)
        if self.in_title:
            self.title_text.append(data)
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
        if parser.html_nav_density not in {"auto", "compact", "relaxed"}:
            errors.append(
                f"{route}: invalid navigation density {parser.html_nav_density!r}"
            )
        if not parser.has_stable_nav_container:
            errors.append(f"{route}: navigation does not use the shared stable layout")
        if parser.has_title_brand:
            errors.append(f"{route}: page-specific brand shifts the navigation layout")
        title = " ".join(" ".join(parser.title_text).split())
        if route in {"/", "/en/"}:
            if title != "Magic · In Progress":
                errors.append(
                    f"{route}: expected browser title 'Magic · In Progress', found {title!r}"
                )
        elif not title.endswith("· Magic"):
            errors.append(
                f"{route}: browser title does not use the Magic identity: {title!r}"
            )
        if "樊宇琛" in title or "Yuchen Fan" in title or "✨" in title:
            errors.append(f"{route}: browser title must stay brand-only: {title!r}")
        if "🤖" in rendered_html:
            errors.append(f"{route}: generic robot favicon still renders")
        for required_id in (
            "navbar",
            "search-toggle",
            "light-toggle",
            "site-page-loader",
        ):
            if required_id not in parser.ids:
                errors.append(f"{route}: missing required control #{required_id}")
        if expected_language == "zh-CN":
            if "site-inline-editor-toggle" not in parser.ids:
                errors.append(f"{route}: Chinese source editor control missing")
            if 'site-author-nav owner-only-control' not in rendered_html:
                errors.append(f"{route}: author navigation must stay hidden until verified")
        elif "site-inline-editor-toggle" in parser.ids:
            errors.append(f"{route}: English reading mirror must not expose source editing")
        for settings_id in (
            "site-settings-toggle",
            "site-settings-dialog",
            "site-settings-format",
            "site-settings-translate",
            "site-settings-commit",
            "site-settings-auth-remember",
            "site-settings-density-auto",
            "site-settings-density-compact",
            "site-settings-density-relaxed",
            "site-settings-font",
            "site-settings-loading-copy",
        ):
            if settings_id not in parser.ids:
                errors.append(f"{route}: missing settings control #{settings_id}")
        for translator_id in (
            "deepseek-translator-dialog",
            "deepseek-translator-key",
            "deepseek-translator-submit",
        ):
            if translator_id not in parser.ids:
                errors.append(f"{route}: missing translation control #{translator_id}")
        for deployment_id in (
            "site-deployment-monitor",
            "site-deployment-monitor-progress",
            "site-deployment-monitor-status",
            "site-deployment-monitor-refresh",
        ):
            if deployment_id not in parser.ids:
                errors.append(f"{route}: missing deployment control #{deployment_id}")
        settings_start = rendered_html.find('id="site-settings-sections"')
        settings_end = rendered_html.find('id="site-settings-new"')
        if (
            settings_start >= 0
            and settings_end > settings_start
            and "page 2" in rendered_html[settings_start:settings_end]
        ):
            errors.append(f"{route}: paginated clone leaked into section settings")
        expected_nav_keys = {
            key for key, visible in parser.settings_visibility.items() if visible
        }
        actual_nav_keys = set(parser.nav_translation_keys)
        if len(parser.nav_translation_keys) != len(actual_nav_keys):
            errors.append(
                f"{route}: duplicate navigation translation keys "
                f"{parser.nav_translation_keys}"
            )
        expected_nav_keys.add("home")
        if actual_nav_keys != expected_nav_keys:
            errors.append(
                f"{route}: navigation keys {sorted(actual_nav_keys)} do not match "
                f"settings {sorted(expected_nav_keys)}"
            )
        expected_active_key = None
        route_without_language = route.removeprefix("/en")
        if route_without_language == "/":
            expected_active_key = "home"
        elif route_without_language.startswith("/blog/"):
            expected_active_key = "blog"
        elif route_without_language.startswith("/tools/"):
            expected_active_key = "tools"
        elif route_without_language.startswith("/spark/"):
            expected_active_key = "spark"
        if expected_active_key and parser.active_nav_translation_keys != [expected_active_key]:
            errors.append(
                f"{route}: expected only {expected_active_key!r} to be active, "
                f"found {parser.active_nav_translation_keys}"
            )
        expected_blog_source = {"/blog/": "_pages/blog-zh.md"}.get(route)
        if expected_blog_source and parser.inline_editor_source_path != expected_blog_source:
            errors.append(
                f"{route}: expected inline editor source {expected_blog_source!r}, "
                f"found {parser.inline_editor_source_path!r}"
            )
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
        if "https://github.com/Functionhx/magic-site-blueprint" not in html:
            errors.append(f"{route}: public Magic site architecture link missing")
        for required_asset in (
            "/assets/img/prof_pic-480.webp",
            "/assets/img/prof_pic-800.webp",
            "/assets/css/home.css",
            "/assets/js/admin-loader.js",
            "/assets/js/navigation-performance.js",
            "/assets/css/site-preferences.css",
            "/assets/js/site-preferences.js",
            "/assets/css/owner-ui.css",
            "/assets/js/owner-ui.js",
        ):
            if required_asset not in html:
                errors.append(f"{route}: missing optimized asset {required_asset}")
        for eager_asset in (
            "/assets/img/prof_pic.jpg",
            "mathjax@",
            "masonry.pkgd",
            "imagesloaded.pkgd",
            "medium-zoom",
            "https://badge.dimensions.ai/badge.js",
            "https://d1bxh8uas1mnw7.cloudfront.net/assets/embed.js",
            "/assets/js/github-auth-vault.js",
            "/assets/js/inline-editor.js",
            "/assets/js/site-settings.js",
        ):
            if eager_asset in html:
                errors.append(f"{route}: performance-sensitive asset loads eagerly: {eager_asset}")
        for removed_home_content in ("精选论文", "selected publications", "555 your office number"):
            if removed_home_content in html:
                errors.append(f"{route}: removed homepage content still renders: {removed_home_content!r}")

    for route in ("/blog/2026/batch-lio/", "/en/blog/2026/batch-lio/"):
        html = route_file(site, route).read_text(encoding="utf-8")
        if 'id="MathJax-script"' not in html:
            errors.append(f"{route}: math article is missing MathJax")

    for route in (
        "/blog/2026/embodied-ai-control-story/",
        "/en/blog/2026/embodied-ai-control-story/",
    ):
        html = route_file(site, route).read_text(encoding="utf-8")
        if 'id="MathJax-script"' in html:
            errors.append(f"{route}: non-math article loads MathJax")

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

    arc_agi_2_cover = "/assets/img/tools/kaggle-agent-arc-agi-cover.webp"
    arc_agi_2_remote_cover = "https://arcprize.org/media/images/blog/arc-agi-task-1ae2feb7.png?v=2"
    for route in ("/tools/", "/en/tools/"):
        html = route_file(site, route).read_text(encoding="utf-8")
        if arc_agi_2_cover not in html:
            errors.append(f"{route}: Kaggle Agent ARC-AGI-2 cover missing")
        if arc_agi_2_remote_cover in html:
            errors.append(f"{route}: Kaggle Agent cover must be served locally")

    for route in ("/spark/",):
        parser = parsed_pages.get(route)
        if not parser:
            continue
        missing_writer_ids = {
            "site-spark-create",
            "site-spark-drafts",
            "site-spark-drafts-panel",
            "site-spark-writer",
            "site-spark-writer-title-zh",
            "site-spark-writer-title-en",
            "site-spark-writer-body-zh",
            "site-spark-writer-body-en",
            "site-spark-writer-translate",
            "site-spark-writer-announce",
            "site-spark-writer-published",
            "site-spark-writer-publish",
        }.difference(parser.ids)
        if missing_writer_ids:
            errors.append(
                f"{route}: direct Spark writer controls missing "
                f"{sorted(missing_writer_ids)}"
            )
    english_spark = parsed_pages.get("/en/spark/")
    if english_spark and {
        "site-spark-create",
        "site-spark-drafts",
        "site-spark-writer",
    }.intersection(english_spark.ids):
        errors.append("/en/spark/: English reading mirror must not expose Spark authoring")

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
        "mailto:functionhx@gmail.com",
        "mailto:2994114386@qq.com",
        "https://github.com/Functionhx",
        "https://www.kaggle.com/funcnano",
        "https://www.linkedin.com/in/zaizai-fan-152611414",
        "https://huggingface.co/Func-nano",
        "/assets/img/social/wechat-qr.png",
    }
    for route in ("/", "/en/"):
        parser = parsed_pages.get(route)
        if not parser:
            continue
        html = route_file(site, route).read_text(encoding="utf-8")
        for official_brand_asset in (
            "/assets/img/social/gmail.svg",
            "/assets/img/social/huggingface.svg",
            "/assets/img/social/qqmail.png",
            "/assets/img/social/wechat-qr.png",
        ):
            if official_brand_asset not in html:
                errors.append(f"{route}: official social brand asset missing: {official_brand_asset}")
        for approximate_icon in ("fa-envelope", "fa-face-smile", "fa-globe", "fa-square-rss"):
            if approximate_icon in html:
                errors.append(f"{route}: approximate social icon still renders: {approximate_icon}")
        for contact_contract in (
            'title="QQ Mail"',
            'title="WeChat"',
            'id="wechat-qr-dialog"',
            "/assets/js/home-contact.js",
        ):
            if contact_contract not in html:
                errors.append(f"{route}: contact UI contract missing: {contact_contract}")
        if "data-settings-theme" in html:
            errors.append(f"{route}: appearance controls must stay in the navigation, not settings")
        if route == "/":
            if "编辑首页介绍" not in html:
                errors.append(f"{route}: homepage editor action must identify the introduction scope")
            missing_editor_ids = {
                "site-author-menu",
                "site-inline-editor-toggle",
                "site-inline-editor",
                "site-inline-editor-body",
                "site-inline-editor-commit",
                "site-inline-editor-auth-remember",
                "site-content-creator",
                "site-content-creator-title-zh",
                "site-content-creator-cover",
                "site-content-creator-commit",
            }.difference(parser.ids)
            if missing_editor_ids:
                errors.append(f"{route}: inline editor controls missing {sorted(missing_editor_ids)}")
        elif {"site-inline-editor", "site-content-creator", "site-author-menu"}.intersection(parser.ids):
            errors.append(f"{route}: English reading mirror must not render authoring controls")
        external_editors = {
            "https://app.pagescms.org/",
            "https://github.dev/Functionhx/functionhx.github.io",
        }.intersection(parser.links)
        if external_editors:
            errors.append(f"{route}: external editor link leaked {sorted(external_editors)}")
        missing_links = required_social_links.difference(parser.links)
        if missing_links:
            errors.append(f"{route}: missing social links {sorted(missing_links)}")

    for route in ("/", "/news/"):
        html = route_file(site, route).read_text(encoding="utf-8")
        if 'class="activity-feed__edit owner-only-control"' not in html:
            errors.append(f"{route}: existing activity rows must expose verified-owner editing")
        if 'data-source-path="_news/' not in html:
            errors.append(f"{route}: activity editor is not bound to its _news source")

    for asset in (
        "assets/css/inline-editor.css",
        "assets/js/inline-editor.js",
        "assets/css/spark-writer.css",
        "assets/js/spark-vault-client.js",
        "assets/js/spark-writer.js",
        "assets/css/site-settings.css",
        "assets/js/site-settings.js",
        "assets/css/deepseek-translator.css",
        "assets/js/deepseek-translator.js",
        "assets/css/deployment-monitor.css",
        "assets/js/deployment-monitor.js",
        "assets/js/github-auth-vault.js",
        "assets/css/magic-search.css",
        "assets/js/magic-search-loader.js",
        "assets/js/magic-search.js",
        "assets/css/media-embeds.css",
        "assets/css/site-preferences.css",
        "assets/js/site-preferences.js",
        "assets/css/owner-ui.css",
        "assets/js/owner-ui.js",
        "assets/css/content-creator.css",
        "assets/js/content-creator.js",
    ):
        if not (site / asset).is_file():
            errors.append(f"/{asset}: authoring asset missing")

    search_indexes = {}
    for language in ("zh", "en"):
        index_path = site / "assets" / "search" / f"index-{language}.json"
        if not index_path.is_file():
            errors.append(f"/assets/search/index-{language}.json: search index missing")
            continue
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f"/assets/search/index-{language}.json: {error}")
            continue
        search_indexes[language] = index
        if index.get("version") != 1 or index.get("language") != language:
            errors.append(f"/assets/search/index-{language}.json: incompatible metadata")
        documents = index.get("documents", [])
        chunks = index.get("chunks", [])
        if len(documents) < 30 or len(chunks) < len(documents):
            errors.append(
                f"/assets/search/index-{language}.json: incomplete public index "
                f"({len(documents)} documents, {len(chunks)} chunks)"
            )
        if not index.get("postings") or not index.get("semantic_endpoint"):
            errors.append(f"/assets/search/index-{language}.json: retrieval metadata missing")
        for chunk in chunks:
            document_index = chunk.get("document")
            document = (
                documents[document_index]
                if isinstance(document_index, int) and 0 <= document_index < len(documents)
                else {}
            )
            if len(chunk.get("chain", [])) < 2 and document.get("kind") != "pages":
                errors.append(
                    f"/assets/search/index-{language}.json: source chain missing for "
                    f"{chunk.get('id', 'unknown')}"
                )
                break
            if not chunk.get("content_hash") or not chunk.get("url"):
                errors.append(
                    f"/assets/search/index-{language}.json: RAG metadata missing for "
                    f"{chunk.get('id', 'unknown')}"
                )
                break
    if set(search_indexes) == {"zh", "en"}:
        chinese_keys = {
            document.get("translation_key")
            for document in search_indexes["zh"].get("documents", [])
        }
        english_keys = {
            document.get("translation_key")
            for document in search_indexes["en"].get("documents", [])
        }
        if chinese_keys != english_keys:
            errors.append("search indexes do not contain matching bilingual documents")

    for route in ("/", "/en/"):
        html = route_file(site, route).read_text(encoding="utf-8")
        if "/assets/js/magic-search-loader.js" not in html:
            errors.append(f"{route}: lazy Magic Search loader missing")
        for eager_search_asset in ("ninja-keys", "/assets/al_search/"):
            if eager_search_asset in html:
                errors.append(f"{route}: legacy search loads eagerly: {eager_search_asset}")

    for route in ("/search/", "/en/search/"):
        html = route_file(site, route).read_text(encoding="utf-8")
        if "data-magic-search-autostart" not in html or "<noscript>" not in html:
            errors.append(f"{route}: interactive search or no-JavaScript fallback missing")

    chinese_nav = " ".join(parsed_pages.get("/", PageParser()).nav_text)
    english_nav = " ".join(parsed_pages.get("/en/", PageParser()).nav_text)
    for label in ("关于",):
        if label not in chinese_nav:
            errors.append(f"/: navigation label {label!r} missing")
    for label in ("about",):
        if label not in english_nav:
            errors.append(f"/en/: navigation label {label!r} missing")
    if "ctrl k" in chinese_nav.lower() or "ctrl k" in english_nav.lower():
        errors.append("navigation must show only the compact search icon")
    if "更多" in chinese_nav:
        errors.append("/: collapsed more navigation must not render")
    if "more" in english_nav:
        errors.append("/en/: collapsed more navigation must not render")

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

    rebuttal_url = "https://rebuttal-reader-functionhx.functionhx.chatgpt.site/"
    rebuttal_github = "https://github.com/Functionhx/rebuttal-reader"
    rebuttal_cover = "/assets/img/tools/rebuttal-reader-cover.webp"
    rebuttal_remote_cover = (
        "https://raw.githubusercontent.com/Functionhx/rebuttal-reader/main/public/og.png?raw=1"
    )
    for route in ("/tools/", "/en/tools/"):
        parser = parsed_pages.get(route)
        if parser and rebuttal_url not in parser.links:
            errors.append(f"{route}: Rebuttal Reader link missing")
        if parser and rebuttal_github not in parser.links:
            errors.append(f"{route}: Rebuttal Reader GitHub link missing")
        html = route_file(site, route).read_text(encoding="utf-8")
        if rebuttal_cover not in html:
            errors.append(f"{route}: Rebuttal Reader README cover missing")
        if rebuttal_remote_cover in html:
            errors.append(f"{route}: Rebuttal Reader cover must be served locally")

    for cover in (arc_agi_2_cover, rebuttal_cover):
        cover_file = site / cover.removeprefix("/")
        if not cover_file.exists():
            errors.append(f"built asset missing: {cover}")
        elif cover_file.stat().st_size > 200_000:
            errors.append(f"built tool cover is unexpectedly large: {cover}")

    if errors:
        print("Built-site validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Built-site validation passed: {len(EXPECTED_ROUTES)} routes and all internal links.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
