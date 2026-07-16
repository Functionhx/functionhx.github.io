#!/usr/bin/env python3
"""Check built HTML links and essential multilingual SEO metadata."""

from __future__ import annotations

import argparse
import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse


BASE_URL = "https://functionhx.github.io/"
BASE_HOST = urlparse(BASE_URL).netloc


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.canonicals: list[str] = []
        self.alternates: dict[str, str] = {}
        self.html_lang: str | None = None
        self.is_redirect = False
        self.language_switch: tuple[str, str] | None = None
        self.has_theme_toggle = False
        self.meta: dict[str, list[str]] = {}
        self.json_ld: list[str] = []
        self._json_ld_buffer: list[str] | None = None
        self.images_without_alt = 0
        self.h1_count = 0
        self.main_count = 0
        self.ids: set[str] = set()
        self.duplicate_ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value for key, value in attrs if value is not None}
        if tag == "html":
            self.html_lang = values.get("lang")
        if tag == "h1":
            self.h1_count += 1
        if tag == "main":
            self.main_count += 1
        if "id" in values:
            if values["id"] in self.ids:
                self.duplicate_ids.add(values["id"])
            self.ids.add(values["id"])
        if tag == "a" and "language-switch" in (values.get("class") or "").split():
            self.language_switch = (values.get("href", ""), values.get("data-translation-found", ""))
        if tag == "button" and values.get("id") == "theme-toggle":
            self.has_theme_toggle = True
        if tag == "img" and "alt" not in values:
            self.images_without_alt += 1
        if tag == "script" and (values.get("type") or "").lower() == "application/ld+json":
            self._json_ld_buffer = []
        for attribute in ("href", "src", "action"):
            if attribute in values:
                self.links.append(values[attribute])
        if "srcset" in values:
            self.links.extend(item.strip().split()[0] for item in values["srcset"].split(",") if item.strip())
        if tag == "link":
            rel = set((values.get("rel") or "").lower().split())
            href = values.get("href")
            if href and "canonical" in rel:
                self.canonicals.append(href)
            if href and "alternate" in rel and values.get("hreflang"):
                self.alternates[values["hreflang"].lower()] = href
        if tag == "meta" and (values.get("http-equiv") or "").lower() == "refresh":
            self.is_redirect = True
        if tag == "meta":
            key = values.get("property") or values.get("name")
            if key and "content" in values:
                self.meta.setdefault(key.lower(), []).append(values["content"])

    def handle_data(self, data: str) -> None:
        if self._json_ld_buffer is not None:
            self._json_ld_buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._json_ld_buffer is not None:
            self.json_ld.append("".join(self._json_ld_buffer).strip())
            self._json_ld_buffer = None


def page_url(root: Path, path: Path) -> str:
    relative = path.relative_to(root).as_posix()
    if relative == "index.html":
        return "/"
    if relative.endswith("/index.html"):
        return "/" + relative[: -len("index.html")]
    return "/" + relative


def target_path(root: Path, current_url: str, raw_link: str) -> Path | None:
    link = raw_link.strip()
    if not link or link.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return None
    parsed_raw = urlparse(link)
    if parsed_raw.scheme and parsed_raw.scheme not in {"http", "https"}:
        return None
    if parsed_raw.netloc and parsed_raw.netloc != BASE_HOST:
        return None
    absolute = urlparse(urljoin(urljoin(BASE_URL, current_url), link))
    if absolute.netloc and absolute.netloc != BASE_HOST:
        return None
    path = unquote(absolute.path)
    if not path:
        return None
    candidate = root / path.lstrip("/")
    if path.endswith("/"):
        return candidate / "index.html"
    if candidate.exists():
        return candidate
    return candidate / "index.html"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path("public"))
    args = parser.parse_args()
    root = args.directory.resolve()
    if not (root / "index.html").is_file():
        print(f"built-site check failed: {root}/index.html does not exist", file=sys.stderr)
        return 1

    errors: list[str] = []
    checked_links = 0
    checked_pages = 0
    language_counts = {"zh-CN": 0, "en-US": 0}
    canonical_pages: dict[str, PageParser] = {}

    for path in sorted(root.rglob("*.html")):
        url = page_url(root, path)
        page = PageParser()
        try:
            page.feed(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as error:
            errors.append(f"cannot parse {url}: {error}")
            continue

        for link in page.links:
            target = target_path(root, url, link)
            if target is None:
                continue
            checked_links += 1
            if not target.exists():
                errors.append(f"broken link in {url}: {link} -> {target.relative_to(root)}")

        if page.is_redirect or url.endswith("404.html") or url == "/write/":
            continue
        checked_pages += 1
        canonical_pages[url] = page
        expected_lang = "en-US" if url.startswith("/en/") or url == "/en/" else "zh-CN"
        if page.html_lang != expected_lang:
            errors.append(f"incorrect html lang in {url}: expected {expected_lang}, found {page.html_lang!r}")
        else:
            language_counts[expected_lang] += 1
        if len(page.canonicals) != 1:
            errors.append(f"expected one canonical in {url}, found {len(page.canonicals)}")
        else:
            canonical = urlparse(page.canonicals[0])
            if canonical.netloc != BASE_HOST or unquote(canonical.path) != url:
                errors.append(f"incorrect canonical in {url}: {page.canonicals[0]}")
        current_hreflang = "en" if expected_lang == "en-US" else "zh-cn"
        if current_hreflang not in page.alternates:
            errors.append(f"missing {current_hreflang} hreflang in {url}")
        if "x-default" not in page.alternates:
            errors.append(f"missing x-default hreflang in {url}")
        if not page.has_theme_toggle:
            errors.append(f"missing PaperMod theme toggle in {url}")
        if page.images_without_alt:
            errors.append(f"{page.images_without_alt} image(s) missing alt attributes in {url}")
        if page.h1_count != 1:
            errors.append(f"expected one h1 in {url}, found {page.h1_count}")
        if page.main_count != 1:
            errors.append(f"expected one main landmark in {url}, found {page.main_count}")
        if page.duplicate_ids:
            errors.append(f"duplicate HTML id(s) in {url}: {', '.join(sorted(page.duplicate_ids))}")
        for metadata_name in (
            "og:title",
            "og:description",
            "og:image",
            "og:locale",
            "twitter:card",
            "twitter:image",
            "twitter:title",
            "twitter:description",
        ):
            if metadata_name not in page.meta:
                errors.append(f"missing {metadata_name} metadata in {url}")
        json_ld_types: set[str] = set()
        for index, raw_json in enumerate(page.json_ld):
            try:
                payload = json.loads(raw_json)
            except json.JSONDecodeError as error:
                errors.append(f"invalid JSON-LD block {index + 1} in {url}: {error}")
                continue
            if isinstance(payload, dict) and isinstance(payload.get("@type"), str):
                json_ld_types.add(payload["@type"])
        if url in {"/", "/en/"} and "Person" not in json_ld_types:
            errors.append(f"missing Person JSON-LD in {url}")
        if url.startswith(("/projects/", "/en/projects/", "/research/", "/en/research/")):
            if not ({"CreativeWork", "SoftwareSourceCode"} & json_ld_types):
                errors.append(f"missing CreativeWork/SoftwareSourceCode JSON-LD in {url}")

    for url, page in canonical_pages.items():
        if page.language_switch is None:
            errors.append(f"missing language switch in {url}")
            continue
        href, found = page.language_switch
        if url == "/":
            counterpart = "/en/"
        elif url == "/en/":
            counterpart = "/"
        elif url.startswith("/en/"):
            counterpart = url[len("/en") :]
        else:
            counterpart = "/en" + url
        if counterpart in canonical_pages:
            if found != "true" or href != counterpart:
                errors.append(
                    f"language switch in {url} should target {counterpart} with translation-found=true; "
                    f"found href={href!r}, translation-found={found!r}"
                )
        else:
            fallback = "/" if url.startswith("/en/") else "/en/"
            if found != "false" or href != fallback:
                errors.append(
                    f"language fallback in {url} should target {fallback}; "
                    f"found href={href!r}, translation-found={found!r}"
                )

    if errors:
        for error in errors:
            print(f"built-site check failed: {error}", file=sys.stderr)
        print(f"{len(errors)} error(s) across {checked_pages} canonical pages", file=sys.stderr)
        return 1
    print(
        "built-site check passed: "
        f"{checked_pages} canonical HTML pages, {checked_links} internal asset/page links, "
        f"{language_counts['zh-CN']} zh-CN and {language_counts['en-US']} en-US pages"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
