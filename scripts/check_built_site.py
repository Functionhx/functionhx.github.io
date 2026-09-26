#!/usr/bin/env python3
"""Check generated routes, bilingual metadata, controls, and internal links."""

from __future__ import annotations

from html.parser import HTMLParser
import json
import re
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit


EXPECTED_ROUTES = (
    "/",
    "/blog/",
    "/paper-notes/",
    "/blog/2026/embodied-ai-control-story/",
    "/blog/2026/batch-lio/",
    "/publications/",
    "/projects/",
    "/repositories/",
    "/teaching/",
    "/people/",
    "/more/",
    "/books/",
    "/tools/",
    "/documents/",
    "/tools/kaggle-agent/",
    "/tools/usage-agent/",
    "/notes/",
    "/logs/",
    "/spark/",
    "/news/",
    "/search/",)
SKIP_SCHEMES = {"mailto", "tel", "javascript", "data"}
# No owner-approved resume is published. Removing a menu or search result alone
# must never allow the retired starter CV to be shipped again at its old URL.
RETIRED_ROUTES = {"/cv/", "/en/cv/"}


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


def check_academic_link(site: Path) -> list[str]:
    """Every page must offer the academic homepage, and work without JavaScript."""
    expected = {
        "index.html": ("https://scholar.fanyuchen.com.cn/zh/", "/academic/zh/"),
    }
    problems = []
    for rel, (href, gh) in expected.items():
        text = (site / rel).read_text(encoding="utf-8")
        if f'id="academic-nav-link" href="{href}"' not in text:
            problems.append(f"{rel}: academic nav link missing or wrong (want {href})")
        if f'data-academic-github="{gh}"' not in text:
            problems.append(f"{rel}: academic github.io path missing (want {gh})")
    return problems


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_built_site.py SITE_DIRECTORY", file=sys.stderr)
        return 2

    site = Path(sys.argv[1]).resolve()
    errors: list[str] = []
    parsed_pages: dict[str, PageParser] = {}

    for route in RETIRED_ROUTES:
        if route_file(site, route).exists() or (site / f"{route.strip('/')}.html").exists():
            errors.append(f"{route}: retired template CV must not be generated")
    sitemap = site / "sitemap.xml"
    if sitemap.is_file():
        sitemap_text = sitemap.read_text(encoding="utf-8")
        for route in RETIRED_ROUTES:
            if f"{route}</loc>" in sitemap_text:
                errors.append(f"{route}: retired template CV remains in the sitemap")

    # Owner decision 2026-09-24: the English site was removed; its URLs 404.
    english_outputs = sorted(
        path.relative_to(site).as_posix() for path in (site / "en").rglob("*") if path.is_file()
    ) if (site / "en").exists() else []
    if english_outputs:
        errors.append(f"/en/: removed English site still generates {english_outputs[:5]}")
    if sitemap.is_file() and "/en/" in sitemap.read_text(encoding="utf-8"):
        errors.append("sitemap.xml: removed English URLs are still listed")

    for route in EXPECTED_ROUTES:
        path = route_file(site, route)
        if not path.is_file():
            errors.append(f"{route}: missing generated file {path}")
            continue
        parser = PageParser()
        rendered_html = path.read_text(encoding="utf-8")
        parser.feed(rendered_html)
        parsed_pages[route] = parser
        if "data-navigation-fallback" not in rendered_html:
            errors.append(f"{route}: no-JavaScript navigation fallback missing")
        function_styles = "/assets/css/function.css" in rendered_html
        function_motion = "/assets/js/function.js" in rendered_html
        if not function_styles or not function_motion:
            errors.append(f"{route}: Chinese Function design assets missing")
        if 'role="contentinfo"' in rendered_html:
            errors.append(f"{route}: removed global footer still renders")

        expected_language = "zh-CN"
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
        brand = "Function"
        if route == "/":
            expected_title = "Function"
            if title != expected_title:
                errors.append(
                    f"{route}: expected browser title {expected_title!r}, found {title!r}"
                )
        elif not title.endswith(f"· {brand}"):
            errors.append(
                f"{route}: browser title does not use the {brand} identity: {title!r}"
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
        if "site-inline-editor-toggle" not in parser.ids:
            errors.append(f"{route}: Chinese source editor control missing")
        if 'site-author-nav owner-only-control' not in rendered_html:
            errors.append(f"{route}: author launcher must stay hidden until verified")
        if 'nav-item site-author-nav' in rendered_html:
            errors.append(f"{route}: author launcher must not consume a navigation item")
        for settings_id in (
            "site-settings-toggle",
            "site-settings-dialog",
            "site-settings-format",
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
        retired_translation_ids = {
            "deepseek-translator-dialog",
            "site-settings-translate",
            "site-settings-title-en",
            "site-content-creator-translate",
            "site-content-creator-title-en",
        }.intersection(parser.ids)
        if retired_translation_ids:
            errors.append(
                f"{route}: Chinese-only site still renders translation controls "
                f"{sorted(retired_translation_ids)}"
            )
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
        elif route_without_language.startswith("/paper-notes/"):
            expected_active_key = "paper-notes"
        elif route_without_language.startswith("/tools/"):
            expected_active_key = "tools" if "tools" in expected_nav_keys else "more"
        elif route_without_language.startswith("/news/"):
            expected_active_key = "news" if "news" in expected_nav_keys else "more"
        elif route_without_language.startswith("/more/"):
            expected_active_key = "more"
        elif route_without_language.startswith("/documents/"):
            expected_active_key = "documents"
        elif route_without_language.startswith("/spark/"):
            expected_active_key = "spark"
        expected_active_keys = (
            [expected_active_key] if expected_active_key in expected_nav_keys else []
        )
        if expected_active_key and parser.active_nav_translation_keys != expected_active_keys:
            errors.append(
                f"{route}: expected active navigation {expected_active_keys!r} for the visible sections, "
                f"found {parser.active_nav_translation_keys}"
            )
        expected_blog_source = {"/blog/": "_pages/blog-zh.md"}.get(route)
        if expected_blog_source and parser.inline_editor_source_path != expected_blog_source:
            errors.append(
                f"{route}: expected inline editor source {expected_blog_source!r}, "
                f"found {parser.inline_editor_source_path!r}"
            )
        if parser.alternates:
            errors.append(f"{route}: single-language site must not declare hreflang alternates {parser.alternates}")
        if route != "/" and "Yuchen Fan" in rendered_html:
            errors.append(f"{route}: English identity leaked into the Chinese page")

    for route in ("/",):
        parser = parsed_pages.get(route)
        if not parser:
            continue
        heading = " ".join(" ".join(parser.h1_text).split())
        expected_identity = "樊宇琛"
        if expected_identity not in heading:
            errors.append(
                f"{route}: expected identity heading {expected_identity!r}, found {heading!r}"
            )
        html = route_file(site, route).read_text(encoding="utf-8")
        if "kaggle-mini-card" in html:
            errors.append(f"{route}: Kaggle monitor must not render on the homepage")
        if "https://functionhx.github.io/kaggle-agent/data/dashboard.json" in html:
            errors.append(f"{route}: Kaggle monitor script must not load on the homepage")
        # 与 kaggle 同一条约束：监控卡片只出现在项目页，不上首页。
        # 首页是身份与导航，不该被定时抓取的数据拖慢或引入失败面。
        if "usage-mini-card" in html:
            errors.append(f"{route}: usage monitor must not render on the homepage")
        if "https://functionhx.github.io/usage-agent/data/" in html:
            errors.append(f"{route}: usage monitor script must not load on the homepage")
        if "https://github.com/Functionhx/magic-site-blueprint" not in html:
            errors.append(f"{route}: public Magic site architecture link missing")
        for required_asset in (
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
        portrait_assets = (
            "/assets/img/function/portrait-hero-v2-960.webp",
            "/assets/img/function/portrait-hero-v2-1760.webp",
            "/assets/css/function-home.css",
        )
        for portrait_asset in portrait_assets:
            if portrait_asset not in html:
                errors.append(f"{route}: missing optimized portrait asset {portrait_asset}")
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

    chinese_home = route_file(site, "/").read_text(encoding="utf-8")
    for home_marker in ('class="function-intro"', 'class="function-directory"', 'class="function-events"', 'id="contact-heading"'):
        if home_marker not in chinese_home:
            errors.append(f"/: approved homepage section missing: {home_marker}")
    if chinese_home.count('class="function-directory-link"') != 4:
        errors.append("/: homepage must keep its four collection entrances")
    for removed_home_asset in ("batch-results.png", "project-featured", "/assets/js/progress-bar.js"):
        if removed_home_asset in chinese_home:
            errors.append(f"/: removed prototype showcase or conflicting runtime: {removed_home_asset}")

    for route in ("/blog/2026/batch-lio/",):
        html = route_file(site, route).read_text(encoding="utf-8")
        if 'id="MathJax-script"' not in html:
            errors.append(f"{route}: math article is missing MathJax")

    for route in ("/blog/2026/embodied-ai-control-story/",):
        html = route_file(site, route).read_text(encoding="utf-8")
        if 'id="MathJax-script"' in html:
            errors.append(f"{route}: non-math article loads MathJax")

    for route in ("/tools/kaggle-agent/",):
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

    # 与上面对 kaggle 的检查对称。
    #
    # 区别：kaggle 那段在页面缺失时 `continue`（路由不存在就静默跳过）。这里**严格要求
    # 页面存在** —— 否则把 _projects/usage-agent-*.md 删掉、或 permalink 写错，检查会
    # 一声不吭地通过，那这条断言就白写了。
    for route in ("/tools/usage-agent/",):
        parser = parsed_pages.get(route)
        if not parser:
            errors.append(f"{route}: usage monitor page is missing")
            continue
        for required_id in (
            "usage-mini-card",
            "um-today",
            "um-week",
            "um-total",
            "um-trend",
            "um-tokens",
            "um-time",
            "um-alert",
        ):
            if required_id not in parser.ids:
                errors.append(f"{route}: missing usage element #{required_id}")
        html = route_file(site, route).read_text(encoding="utf-8")
        if "https://functionhx.github.io/usage-agent/data/hosts.json" not in html:
            errors.append(f"{route}: usage data endpoint missing from generated HTML")

    arc_agi_2_cover = "/assets/img/tools/kaggle-agent-arc-agi-cover.webp"
    arc_agi_2_remote_cover = "https://arcprize.org/media/images/blog/arc-agi-task-1ae2feb7.png?v=2"
    for route in ("/tools/",):
        html = route_file(site, route).read_text(encoding="utf-8")
        if arc_agi_2_cover not in html:
            errors.append(f"{route}: Kaggle Agent ARC-AGI-2 cover missing")
        if arc_agi_2_remote_cover in html:
            errors.append(f"{route}: Kaggle Agent cover must be served locally")

    documents_zh = route_file(site, "/documents/").read_text(encoding="utf-8")
    for route, html in (("/documents/", documents_zh),):
        for required_id in (
            "feishu-public-library",
            "feishu-public-list",
            "feishu-public-list-status",
        ):
            if f'id="{required_id}"' not in html:
                errors.append(f"{route}: missing public Feishu showcase #{required_id}")
        if "/assets/js/feishu-showcase.js" not in html:
            errors.append(f"{route}: public Feishu showcase client is missing")
    for required_id in (
        "feishu-document-dialog",
        "feishu-document-creator",
        "feishu-document-status",
        "feishu-document-title",
        "feishu-document-connect",
        "feishu-document-submit",
        "feishu-document-result",
        "feishu-document-library",
        "feishu-document-list",
        "feishu-document-list-status",
        "feishu-document-refresh",
        "feishu-document-delete-dialog",
        "feishu-document-delete-form",
        "feishu-document-delete-title",
        "feishu-document-delete-status",
        "feishu-document-delete-cancel",
        "feishu-document-delete-submit",
    ):
        if f'id="{required_id}"' not in documents_zh:
            errors.append(f"/documents/: missing Feishu creation control #{required_id}")
    if 'data-author-action="feishu-document-create"' not in documents_zh:
        errors.append("/documents/: contextual pencil is missing Feishu creation")
    if 'data-author-action="source-edit"' in documents_zh:
        errors.append("/documents/: contextual pencil must not expose generic page editing")
    if "/assets/js/feishu-documents.js" in documents_zh:
        errors.append("/documents/: Feishu creation code must load only after owner intent")

    feishu_client_path = site.parent / "assets" / "js" / "feishu-documents.js"
    feishu_client_text = (
        feishu_client_path.read_text(encoding="utf-8")
        if feishu_client_path.exists()
        else ""
    )
    for contract in (
        '"/api/feishu/session"',
        '"/api/feishu/oauth/start"',
        '"/api/feishu/documents"',
        "/api/feishu/library-page",
        '"/api/feishu/showcase"',
        "idempotency_key",
        "event.origin !== expectedOrigin",
        "event.source !== popup",
        'event.data?.type !== "functionhx:feishu-connected"',
        'officialAuthorizeOrigin = "https://accounts.feishu.cn"',
        "vaultClient.request",
        'link.target = "_blank"',
        'method: "DELETE"',
        'method: "PUT"',
        "dataset.feishuDelete",
        "dataset.feishuShowcase",
    ):
        if contract not in feishu_client_text:
            errors.append(
                f"assets/js/feishu-documents.js: integration contract {contract!r} missing"
            )
    if '"functionhx-feishu-document"' in feishu_client_text:
        errors.append("assets/js/feishu-documents.js: creation must not pre-open a document popup")

    feishu_showcase_path = site.parent / "assets" / "js" / "feishu-showcase.js"
    feishu_showcase_text = (
        feishu_showcase_path.read_text(encoding="utf-8")
        if feishu_showcase_path.exists()
        else ""
    )
    for contract in (
        "/public/feishu/documents",
        'link.target = "_blank"',
        'hostname === "feishu.cn"',
        'root.hidden = true',
    ):
        if contract not in feishu_showcase_text:
            errors.append(
                f"assets/js/feishu-showcase.js: public-list contract {contract!r} missing"
            )
    if "selection_token" in feishu_showcase_text:
        errors.append("assets/js/feishu-showcase.js: public client must not receive owner selection tokens")

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
            "site-spark-writer-body-zh",
            "site-spark-writer-announce",
            "site-spark-writer-published",
            "site-spark-writer-publish",
        }.difference(parser.ids)
        if missing_writer_ids:
            errors.append(
                f"{route}: direct Spark writer controls missing "
                f"{sorted(missing_writer_ids)}"
            )
        retired_writer_ids = {
            "site-spark-writer-title-en",
            "site-spark-writer-body-en",
            "site-spark-writer-translate",
        }.intersection(parser.ids)
        if retired_writer_ids:
            errors.append(
                f"{route}: Chinese-only Spark writer still renders English controls "
                f"{sorted(retired_writer_ids)}"
            )
    article_sources = {
        "/blog/2026/embodied-ai-control-story/": (
            "https://zhuanlan.zhihu.com/p/2048053637985859286"
        ),
        "/blog/2026/batch-lio/": (
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
        if "发布于" not in html:
            errors.append(f"{route}: Chinese publication date label missing")
        # The rail tree is rendered by the layout so it works without JavaScript.
        if 'id="post-tree"' not in html or 'class="post-tree__branch"' not in html:
            errors.append(f"{route}: article section tree missing")
        if "/assets/js/post.js" not in html:
            errors.append(f"{route}: article rail script missing")
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
        "tencent://message/?uin=2994114386&Site=Magic&Menu=yes",
        "https://github.com/Functionhx",
        "https://www.kaggle.com/funcnano",
        "https://www.linkedin.com/in/zaizai-fan-152611414",
        "https://huggingface.co/Func-nano",
        "/assets/img/social/wechat-qr.png",
    }
    for route in ("/",):
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
            'title="QQ · 2994114386"',
            "fa-brands fa-qq",
            'title="WeChat"',
            'id="wechat-qr-dialog"',
            'id="contact-copy-status"',
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
    for language in ("zh",):
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
        if index.get("audience") != "visitor":
            errors.append(f"/assets/search/index-{language}.json: visitor scope is missing")
        documents = index.get("documents", [])
        chunks = index.get("chunks", [])
        if any(document.get("translation_key") == "cv" or document.get("url") in RETIRED_ROUTES for document in documents):
            errors.append(f"/assets/search/index-{language}.json: retired template CV remains searchable")
        if not documents or len(chunks) < len(documents):
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
    if (site / "assets" / "search" / "index-en.json").exists():
        errors.append("/assets/search/index-en.json: removed English site is still indexed")

    for route in ("/",):
        html = route_file(site, route).read_text(encoding="utf-8")
        if "/assets/js/magic-search-loader.js" not in html:
            errors.append(f"{route}: lazy Magic Search loader missing")
        for eager_search_asset in ("ninja-keys", "/assets/al_search/"):
            if eager_search_asset in html:
                errors.append(f"{route}: legacy search loads eagerly: {eager_search_asset}")

    for route in ("/search/",):
        html = route_file(site, route).read_text(encoding="utf-8")
        if "data-magic-search-autostart" not in html or "<noscript>" not in html:
            errors.append(f"{route}: interactive search or no-JavaScript fallback missing")
        language = "zh"
        fallback = "".join(re.findall(r"<noscript>(.*?)</noscript>", html, re.DOTALL))
        for document in search_indexes.get(language, {}).get("documents", []):
            if f'href="{document["url"]}"' not in fallback:
                errors.append(f"{route}: no-JavaScript search is missing {document['url']}")
        for hidden_route in ("/books/", "/repositories/", "/tools/"):
            visible_keys = parsed_pages.get("/", PageParser()).settings_visibility
            if not visible_keys.get(hidden_route.strip("/"), False):
                if f'href="{hidden_route}' in fallback:
                    errors.append(f"{route}: hidden section leaked through the no-JavaScript fallback")

    chinese_nav = " ".join(parsed_pages.get("/", PageParser()).nav_text)
    for label in ("Function",):
        if label not in chinese_nav:
            errors.append(f"/: navigation label {label!r} missing")
    if "ctrl k" in chinese_nav.lower():
        errors.append("navigation must show only the compact search icon")
    if parsed_pages.get("/", PageParser()).settings_visibility.get("more") and "更多" not in chinese_nav:
        errors.append("/: accessible more navigation label is missing")

    for route in ("/projects/",):
        path = route_file(site, route)
        if path.is_file():
            html = path.read_text(encoding="utf-8")
            project_marker = 'class="function-project"'
            # 这个数字随 _projects/ 里新增条目而变。加 usage-agent 时从 9 提到 10 ——
            # 是刻意的（确实多了一个项目），不是为了让测试变绿。
            if html.count(project_marker) != 10:
                errors.append(f"{route}: expected all ten existing project entries")

    for route in ("/publications/",):
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

    for route, locale in (("/repositories/", "cn"),):
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
            if not split.netloc or split.hostname in {"functionhx.github.io", "fanyuchen.com.cn", "www.fanyuchen.com.cn"}:
                normalized_route = unquote(split.path).removesuffix("index.html").rstrip("/") + "/"
                if normalized_route in RETIRED_ROUTES:
                    errors.append(f"{page_route}: link to retired template CV {href!r}")
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
    for route in ("/tools/",):
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

    errors.extend(check_academic_link(site))

    if errors:
        print("Built-site validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Built-site validation passed: {len(EXPECTED_ROUTES)} routes and all internal links.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
