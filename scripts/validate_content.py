#!/usr/bin/env python3
"""Validate bilingual source content and project-specific integration contracts."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
CONTENT_DIRECTORIES = (
    "_pages",
    "_projects",
    "_news",
    "_posts",
    "_teachings",
    "_books",
)
LANGUAGES = {"zh", "en"}
REQUIRED_ROUTES = {
    "home": {"/", "/en/"},
    "blog": {"/blog/", "/en/blog/"},
    "publications": {"/publications/", "/en/publications/"},
    "projects": {"/projects/", "/en/projects/"},
    "repositories": {"/repositories/", "/en/repositories/"},
    "cv": {"/cv/", "/en/cv/"},
    "teaching": {"/teaching/", "/en/teaching/"},
    "people": {"/people/", "/en/people/"},
    "more": {"/more/", "/en/more/"},
    "books": {"/books/", "/en/books/"},
    "tools": {"/tools/", "/en/tools/"},
    "notes": {"/notes/", "/en/notes/"},
    "logs": {"/logs/", "/en/logs/"},
    "spark": {"/spark/", "/en/spark/"},
    "news": {"/news/", "/en/news/"},
    "search": {"/search/", "/en/search/"},
    "not-found": {"/404.html", "/en/404/"},
}


def front_matter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", text, re.DOTALL)
    if not match:
        raise ValueError("missing YAML front matter")
    data = yaml.safe_load(match.group(1))
    if not isinstance(data, dict):
        raise ValueError("front matter must be a mapping")
    return data


def main() -> int:
    errors: list[str] = []
    records: list[tuple[str, Path, dict]] = []

    for directory_name in CONTENT_DIRECTORIES:
        directory = ROOT / directory_name
        if not directory.exists():
            continue
        for path in sorted(directory.rglob("*")):
            if path.suffix not in {".md", ".markdown", ".html"}:
                continue
            try:
                data = front_matter(path)
            except (OSError, ValueError, yaml.YAMLError) as error:
                errors.append(f"{path.relative_to(ROOT)}: {error}")
                continue
            records.append((directory_name, path, data))

    groups: dict[tuple[str, str], list[tuple[Path, dict]]] = defaultdict(list)
    for collection, path, data in records:
        relative = path.relative_to(ROOT)
        language = data.get("lang")
        key = data.get("translation_key")
        if language not in LANGUAGES:
            errors.append(f"{relative}: lang must be one of {sorted(LANGUAGES)}")
        if not isinstance(key, str) or not key.strip():
            errors.append(f"{relative}: translation_key is required")
            continue

        if collection == "_projects":
            for field in ("description", "kind"):
                if not data.get(field):
                    errors.append(f"{relative}: project field {field!r} is required")
        if collection == "_posts":
            slug = data.get("slug")
            if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9-]+", slug):
                errors.append(
                    f"{relative}: slug must contain only lowercase letters, "
                    "numbers, and hyphens"
                )
            if not isinstance(data.get("published"), bool):
                errors.append(f"{relative}: published must be true or false")

        if collection != "_posts" or data.get("published") is not False:
            groups[(collection, key)].append((path, data))

    for (collection, key), items in sorted(groups.items()):
        languages = [data.get("lang") for _, data in items]
        if set(languages) != LANGUAGES or len(languages) != len(LANGUAGES):
            locations = ", ".join(str(path.relative_to(ROOT)) for path, _ in items)
            errors.append(
                f"{collection}/{key}: expected exactly zh and en; "
                f"found {languages} in {locations}"
            )

    page_routes: dict[str, set[str]] = defaultdict(set)
    for collection, _, data in records:
        if collection == "_pages" and data.get("translation_key") in REQUIRED_ROUTES:
            page_routes[data["translation_key"]].add(data.get("permalink"))
    for key, expected in REQUIRED_ROUTES.items():
        if page_routes[key] != expected:
            errors.append(
                f"_pages/{key}: expected permalinks {sorted(expected)}, "
                f"found {sorted(str(route) for route in page_routes[key])}"
            )

    config_path = ROOT / "_config.yml"
    try:
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        errors.append(f"_config.yml: {error}")
        config = {}
    if config.get("theme") != "al_folio_core":
        errors.append("_config.yml: theme must remain al_folio_core")
    if config.get("url") != "https://functionhx.github.io":
        errors.append("_config.yml: canonical url must be https://functionhx.github.io")
    if config.get("baseurl") != "":
        errors.append("_config.yml: baseurl must be empty for the user Pages site")
    if config.get("enable_darkmode") is not True:
        errors.append("_config.yml: enable_darkmode must remain true")
    if config.get("footer_fixed") is not False:
        errors.append("_config.yml: the removed global footer must remain disabled")
    if config.get("icon") != "ƒ":
        errors.append("_config.yml: the site favicon must use the Magic identity mark")
    giscus = config.get("giscus", {})
    if giscus.get("repo") != "Functionhx/functionhx.github.io":
        errors.append("_config.yml: Giscus repository is not configured")
    if not giscus.get("repo_id") or not giscus.get("category_id"):
        errors.append("_config.yml: Giscus repository and category IDs are required")

    site_ui_path = ROOT / "_data" / "site_ui.yml"
    try:
        site_ui = yaml.safe_load(site_ui_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        errors.append(f"_data/site_ui.yml: {error}")
        site_ui = {}
    if not isinstance(site_ui, dict):
        errors.append("_data/site_ui.yml: settings must be a mapping")
        site_ui = {}
    if site_ui.get("navigation_density") not in {"auto", "compact", "relaxed"}:
        errors.append(
            "_data/site_ui.yml: navigation_density must be auto, compact, or relaxed"
        )

    workflow_path = ROOT / ".github" / "workflows" / "deploy.yml"
    workflow_text = (
        workflow_path.read_text(encoding="utf-8") if workflow_path.exists() else ""
    )
    if "cancel-in-progress: true" not in workflow_text:
        errors.append(
            ".github/workflows/deploy.yml: newer site commits must supersede older deployments"
        )

    inline_editor_path = ROOT / "assets" / "js" / "inline-editor.js"
    inline_editor_text = (
        inline_editor_path.read_text(encoding="utf-8")
        if inline_editor_path.exists()
        else ""
    )
    for contract in (
        "https://api.github.com",
        "Functionhx",
        "window.localStorage",
        "window.functionhxGitHubAuth",
        "window.functionhxDeployment",
        'method: "PUT"',
        "Authorization",
    ):
        if contract not in inline_editor_text:
            errors.append(
                f"assets/js/inline-editor.js: integration contract {contract!r} missing"
            )

    content_creator_path = ROOT / "assets" / "js" / "content-creator.js"
    content_creator_text = (
        content_creator_path.read_text(encoding="utf-8")
        if content_creator_path.exists()
        else ""
    )
    for contract in (
        "window.functionhxGitHubAuth",
        "window.functionhxDeployment",
        "saveOpaque",
        "/git/blobs",
        "/git/trees",
        'method: "PATCH"',
        'announce: ${values.announce ? "true" : "false"}',
        "English translation pending",
    ):
        if contract not in content_creator_text:
            errors.append(
                f"assets/js/content-creator.js: integration contract {contract!r} missing"
            )

    spark_writer_path = ROOT / "assets" / "js" / "spark-writer.js"
    spark_writer_text = (
        spark_writer_path.read_text(encoding="utf-8")
        if spark_writer_path.exists()
        else ""
    )
    for contract in (
        "window.functionhxGitHubAuth",
        "window.functionhxSparkVault",
        "window.functionhxDeployment",
        "saveOpaque",
        "restoreOpaque",
        'vaultRequest("/api/notes")',
        'method: "PUT"',
        'method: "POST"',
        "/publish",
        "/unpublish",
        "loadPrivateDrafts",
        "announce",
        "ensureVaultUnlocked",
        "privatePayloadValues",
        "hydrateVaultNote",
    ):
        if contract not in spark_writer_text:
            errors.append(
                f"assets/js/spark-writer.js: integration contract "
                f"{contract!r} missing"
            )
    for forbidden_contract in (
        'headers.Authorization = `Bearer ${options.token}`',
        "/git/trees",
        'method: "PATCH"',
    ):
        if forbidden_contract in spark_writer_text:
            errors.append(
                "assets/js/spark-writer.js: private Spark must not write "
                f"directly to the public repository ({forbidden_contract!r})"
            )

    spark_client_path = ROOT / "assets" / "js" / "spark-vault-client.js"
    spark_client_text = (
        spark_client_path.read_text(encoding="utf-8")
        if spark_client_path.exists()
        else ""
    )
    for contract in (
        "functionhxSparkVault",
        "X-Spark-Session",
        "saveOpaque",
        "restoreOpaque",
        "functionhx:spark-vault-session",
        "functionhx:spark-vault-unlocked",
        "functionhx:spark-vault-decoy",
        "functionhx:zk2:",
        "rootKeys",
        "sealValues",
        "openValues",
        "event.origin !== expectedOrigin",
    ):
        if contract not in spark_client_text:
            errors.append(
                f"assets/js/spark-vault-client.js: security contract "
                f"{contract!r} missing"
            )

    spark_worker_path = ROOT / "spark-vault" / "worker.mjs"
    spark_worker_text = (
        spark_worker_path.read_text(encoding="utf-8")
        if spark_worker_path.exists()
        else ""
    )
    for contract in (
        "AES-GCM",
        "MASTER_KEY_B64",
        "SESSION_KEY_B64",
        "ALLOWED_GITHUB_USER_ID",
        "PRIVATE_REPO",
        "PUBLIC_REPO",
        "assertAllowedOrigin",
        "commitPublicPair",
        "encryptRecord",
        "KEYRING_PATH",
        "loadKeyring",
        "saveKeyring",
        "createUnlockPage",
        '"published: true"',
    ):
        if contract not in spark_worker_text:
            errors.append(
                f"spark-vault/worker.mjs: security contract {contract!r} missing"
            )

    unlock_page_path = ROOT / "spark-vault" / "unlock-page.mjs"
    unlock_page_text = (
        unlock_page_path.read_text(encoding="utf-8")
        if unlock_page_path.exists()
        else ""
    )
    for contract in (
        "WebAuthn-PRF",
        'iterations:600000',
        'pin==="608"',
        "functionhx:spark-vault-decoy",
        "functionhx:spark-vault-unlocked",
        "magic-spark-vault-recovery.json",
        "Content-Security-Policy",
    ):
        if contract not in unlock_page_text:
            errors.append(
                f"spark-vault/unlock-page.mjs: zero-knowledge contract "
                f"{contract!r} missing"
            )

    site_settings_path = ROOT / "assets" / "js" / "site-settings.js"
    site_settings_text = (
        site_settings_path.read_text(encoding="utf-8")
        if site_settings_path.exists()
        else ""
    )
    for contract in (
        "/git/trees",
        'method: "POST"',
        'method: "PATCH"',
        "force: false",
        "window.functionhxDeepSeek.translate",
        "window.functionhxGitHubAuth",
        "window.functionhxDeployment",
        "setNavigationVisibility",
        "setNavigationDensity",
        "createPageSource",
        "syncPersonalization",
        "selectLoadingCopy",
    ):
        if contract not in site_settings_text:
            errors.append(
                f"assets/js/site-settings.js: integration contract "
                f"{contract!r} missing"
            )

    preferences_path = ROOT / "assets" / "js" / "site-preferences.js"
    preferences_text = (
        preferences_path.read_text(encoding="utf-8")
        if preferences_path.exists()
        else ""
    )
    for contract in (
        "functionhx:site-font",
        "functionhx:loading-copy",
        "anthropic-serif",
        "anthropic-sans",
        "dyslexic",
        "getLoadingText",
        "showLoading",
        "hideLoading",
    ):
        if contract not in preferences_text:
            errors.append(
                f"assets/js/site-preferences.js: personalization contract "
                f"{contract!r} missing"
            )

    public_copy_paths = (
        ROOT / "_pages",
        ROOT / "_includes",
        ROOT / "_layouts",
        ROOT / "_plugins",
        ROOT / "assets" / "js",
        ROOT / "spark-vault" / "worker.mjs",
    )
    for source in public_copy_paths:
        candidates = [source] if source.is_file() else source.rglob("*")
        for candidate in candidates:
            if not candidate.is_file() or candidate.suffix not in {".js", ".liquid", ".md", ".mjs", ".rb"}:
                continue
            if "闪耀" in candidate.read_text(encoding="utf-8"):
                errors.append(
                    f"{candidate.relative_to(ROOT)}: user-facing Spark name must not use 闪耀"
                )

    auth_vault_path = ROOT / "assets" / "js" / "github-auth-vault.js"
    auth_vault_text = (
        auth_vault_path.read_text(encoding="utf-8")
        if auth_vault_path.exists()
        else ""
    )
    for contract in (
        "indexedDB",
        "AES-GCM",
        "generateKey",
        "functionhx:github-auth-changed",
        "ciphertext",
        "saveOpaque",
        "restoreOpaque",
    ):
        if contract not in auth_vault_text:
            errors.append(
                f"assets/js/github-auth-vault.js: trusted-device contract "
                f"{contract!r} missing"
            )
    for forbidden_storage in ("localStorage", "sessionStorage"):
        if forbidden_storage in auth_vault_text:
            errors.append(
                "assets/js/github-auth-vault.js: GitHub credentials must not "
                f"use {forbidden_storage}"
            )

    deployment_path = ROOT / "assets" / "js" / "deployment-monitor.js"
    deployment_text = (
        deployment_path.read_text(encoding="utf-8")
        if deployment_path.exists()
        else ""
    )
    for contract in (
        "/actions/runs",
        'url.searchParams.set("head_sha", sha)',
        'url.searchParams.set("event", "push")',
        "functionhxDeployment",
        'run.conclusion === "success"',
    ):
        if contract not in deployment_text:
            errors.append(
                f"assets/js/deployment-monitor.js: deployment contract "
                f"{contract!r} missing"
            )

    deepseek_path = ROOT / "assets" / "js" / "deepseek-translator.js"
    deepseek_text = (
        deepseek_path.read_text(encoding="utf-8") if deepseek_path.exists() else ""
    )
    for contract in (
        'response_format: { type: "json_object" }',
        "Authorization",
        "Never add facts",
    ):
        if contract not in deepseek_text:
            errors.append(
                f"assets/js/deepseek-translator.js: integration contract "
                f"{contract!r} missing"
            )
    for forbidden_storage in ("localStorage", "sessionStorage"):
        if forbidden_storage in deepseek_text:
            errors.append(
                "assets/js/deepseek-translator.js: DeepSeek credentials must "
                f"not use {forbidden_storage}"
            )
    deepseek_include_path = ROOT / "_includes" / "deepseek-translator.liquid"
    deepseek_include_text = (
        deepseek_include_path.read_text(encoding="utf-8")
        if deepseek_include_path.exists()
        else ""
    )
    for contract in (
        "https://api.deepseek.com/chat/completions",
        "deepseek-v4-pro",
    ):
        if contract not in deepseek_include_text:
            errors.append(
                f"_includes/deepseek-translator.liquid: integration contract "
                f"{contract!r} missing"
            )

    kaggle_path = ROOT / "_includes" / "kaggle-monitor.liquid"
    kaggle_text = kaggle_path.read_text(encoding="utf-8") if kaggle_path.exists() else ""
    if "https://functionhx.github.io/kaggle-agent/data/dashboard.json" not in kaggle_text:
        errors.append("_includes/kaggle-monitor.liquid: canonical dashboard endpoint missing")
    if "5 * 60 * 1000" not in kaggle_text:
        errors.append("_includes/kaggle-monitor.liquid: five-minute refresh contract missing")

    video_path = ROOT / "_includes" / "video.liquid"
    video_text = video_path.read_text(encoding="utf-8") if video_path.exists() else ""
    for contract in (
        "preload=\"none\"",
        "playsinline",
        "kind=\"captions\"",
        "captions_zh",
        "captions_en",
    ):
        if contract not in video_text:
            errors.append(f"_includes/video.liquid: video contract {contract!r} missing")

    search_generator_path = ROOT / "_plugins" / "magic_search_generator.rb"
    search_generator_text = (
        search_generator_path.read_text(encoding="utf-8")
        if search_generator_path.exists()
        else ""
    )
    for contract in (
        'data["published"] != false',
        'data["private"] != true',
        'data["visibility"] != "private"',
        "content_hash",
        "postings",
        "search_path",
    ):
        if contract not in search_generator_text:
            errors.append(
                f"_plugins/magic_search_generator.rb: search boundary "
                f"contract {contract!r} missing"
            )

    semantic_server_path = ROOT / "magic-search" / "server.py"
    semantic_server_text = (
        semantic_server_path.read_text(encoding="utf-8")
        if semantic_server_path.exists()
        else ""
    )
    for contract in (
        "content_hash",
        "sqlite3",
        "MAX_QUERY_CHARACTERS",
        "allowed_origins",
        "RateLimiter",
    ):
        if contract not in semantic_server_text:
            errors.append(
                f"magic-search/server.py: semantic retrieval contract {contract!r} missing"
            )
    for forbidden_provider in ("api.deepseek.com", "api.openai.com"):
        if forbidden_provider in semantic_server_text.lower():
            errors.append(
                "magic-search/server.py: retrieval-only service must not call "
                f"{forbidden_provider}"
            )

    search_frontend_path = ROOT / "assets" / "js" / "magic-search.js"
    search_frontend_text = (
        search_frontend_path.read_text(encoding="utf-8")
        if search_frontend_path.exists()
        else ""
    )
    for contract in (
        'element("button", "magic-search__escape", "esc")',
        "if (visible.length === 6)",
        'if (!query) return [];',
    ):
        if contract not in search_frontend_text:
            errors.append(
                f"assets/js/magic-search.js: compact search contract {contract!r} missing"
            )
    for cluttered_control in (
        "magic-search__scopes",
        "magic-search__header",
        "magic-search__footer",
        "magic-search__excerpt",
        "recentResults",
    ):
        if cluttered_control in search_frontend_text:
            errors.append(
                "assets/js/magic-search.js: compact search must not render "
                f"{cluttered_control!r}"
            )

    nginx_path = ROOT / "deploy" / "nginx" / "fanyuchen.com.cn.conf"
    nginx_text = nginx_path.read_text(encoding="utf-8") if nginx_path.exists() else ""
    for contract in (
        "gzip on;",
        "location ^~ /api/magic-search/",
        "proxy_pass http://127.0.0.1:8790/;",
    ):
        if contract not in nginx_text:
            errors.append(f"deploy/nginx/fanyuchen.com.cn.conf: {contract!r} missing")

    license_path = ROOT / "LICENSE"
    license_text = license_path.read_text(encoding="utf-8") if license_path.exists() else ""
    if "MIT License" not in license_text or "Maruan Al-Shedivat" not in license_text:
        errors.append("LICENSE: upstream al-folio MIT attribution must be retained")

    bibliography = (ROOT / "_bibliography" / "papers.bib").read_text(encoding="utf-8")
    if "PhysRev.47.777" not in bibliography:
        errors.append("_bibliography/papers.bib: original demo bibliography is missing")
    banned_editorial_phrases = (
        "原版占位",
        "原版节奏",
        "完整复刻",
        "original demo",
        "original demo placeholder",
        "original al-folio demo",
    )
    for _, path, _ in records:
        text = path.read_text(encoding="utf-8").lower()
        for phrase in banned_editorial_phrases:
            if phrase.lower() in text:
                errors.append(
                    f"{path.relative_to(ROOT)}: remove editorial phrase {phrase!r}"
                )

    if errors:
        print("Source validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        f"Source validation passed: {len(records)} bilingual records, "
        f"{len(groups)} translation pairs."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
