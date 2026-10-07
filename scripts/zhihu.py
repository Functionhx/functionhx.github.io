#!/usr/bin/env python3
"""把博客文章同步到知乎专栏（站长决定 2026-10-07：官方接口首发，Cookie 草稿兜底）。

    python3 scripts/zhihu.py status              每篇文章的同步状态
    python3 scripts/zhihu.py preview gpa         转换成知乎 HTML，打开本地预览
    python3 scripts/zhihu.py publish gpa         首发：官方 Publish OpenAPI，预览后输入「发布」才发
    python3 scripts/zhihu.py draft gpa           文章改过之后：把新版本存成知乎草稿（永不自动发布）
    python3 scripts/zhihu.py synced gpa          在知乎点了「发布更新」之后，记一笔
    python3 scripts/zhihu.py link gpa <知乎链接>  手动发到知乎的文章，补上对应关系
    python3 scripts/zhihu.py login openapi|cookie 把凭证存进 macOS 钥匙串
    python3 scripts/zhihu.py doctor [--online]   检查凭证、构建产物和依赖（不打印任何密钥）

两条通道：
- 首发走知乎官方 Publish OpenAPI（github.com/zhihu/ZhihuPublisher 的协议：POST /openapi/publish，
  HMAC-SHA256 签名，每人每天最多 50 次）。官方接口没有草稿、请求即发布，所以这里先生成本地预览，
  站长看过、在终端输入「发布」之后才发送。
- 官方接口不能修改已发布的文章。文章改过之后，用网页登录的 Cookie 调知乎专栏的草稿接口
  （PATCH /api/articles/<id>/draft），只存草稿，最后由站长在知乎点「发布更新」。这是没有文档的
  内部接口，可能会变；本脚本从不调用它的发布接口。

正文从构建好的 _site 页面里取（与网站看到的一致：Liquid、脚注、公式、作者便利贴都已渲染），
按 ZhihuPublisher 的转换规范变成知乎白名单 HTML。图片必须先上传知乎媒体云：文章有图片时需要
官方的 zhihu-mediacloud-uploader（pip install git+https://github.com/zhihu/zhihu-mediacloud-uploader），
没有就停下，绝不拿原始地址凑合。

凭证读取顺序：环境变量（ZHIHU_OPENAPI_APP_KEY / ZHIHU_OPENAPI_APP_SECRET / ZHIHU_COOKIE）→
macOS 钥匙串（服务名 functionhx-zhihu）→ 官方共享文件 ~/.zhihu/openapi-credentials.json。
密钥、签名和 Cookie 不写进任何文件、日志或输出。只用 Python 标准库。
"""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from html import escape
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlparse
from urllib.request import Request, urlopen
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "_site"
POSTS = ROOT / "_posts"
SYNC_FILE = ROOT / "_data" / "syndication.json"
OUT = ROOT / ".zhihu-out"
SITE_URL = "https://functionhx.github.io"
KEYCHAIN_SERVICE = "functionhx-zhihu"
SHARED_CREDENTIALS = Path.home() / ".zhihu" / "openapi-credentials.json"
PUBLISH_LOG = Path.home() / ".zhihu" / "functionhx-publish-log.json"
OPENAPI_BASE = os.environ.get("ZHIHU_PUBLISH_BASE_URL", "https://openapi.zhihu.com").rstrip("/")
WEB_BASE = os.environ.get("ZHIHU_WEB_BASE_URL", "https://zhuanlan.zhihu.com").rstrip("/")
DAILY_LIMIT = 50
CST = timezone(timedelta(hours=8))
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"

COMMENT_CHOICES = [
    ("任何人都可以评论", "all"),
    ("不允许评论", "nobody"),
    ("我关注的人能评论", "followee"),
    ("仅显示我筛选后的评论", "censor"),
    ("关注我的人能评论", "follower"),
]
STATEMENT_CHOICES = [
    ("没有声明", ""),
    ("包含剧透", "spoiler"),
    ("包含医疗建议", "medical_advice"),
    ("虚构创作", "fictional_creation"),
    ("包含理财内容", "contain_finance"),
    ("包含 AI 辅助创作，作者对内容负责", "ai_creation"),
]
# 代码块语言：站内 Rouge 的名字 → 知乎的 lang id（code-languages.md）；不认识的照原样，空的写 ""。
LANGUAGE_IDS = {
    "javascript": "js",
    "typescript": "ts",
    "py": "python",
    "shell": "bash",
    "sh": "bash",
    "zsh": "bash",
    "console": "bash",
    "yml": "yaml",
    "c++": "cpp",
    "cxx": "cpp",
    "c#": "csharp",
    "cs": "csharp",
    "ruby": "rb",
    "dockerfile": "docker",
    "makefile": "make",
    "plaintext": "",
    "text": "",
    "txt": "",
    "md": "markdown",
}


class ZhihuError(Exception):
    """给站长看的错误：一句话说清楚哪里不对、下一步做什么。"""


# ---------------------------------------------------------------- 文章与构建产物


def front_matter(path: Path) -> dict[str, str]:
    """只读需要的几个标量字段（title / slug / permalink / published / description），不依赖 PyYAML。"""
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---", text, re.DOTALL)
    data: dict[str, str] = {}
    for line in (match.group(1).splitlines() if match else []):
        item = re.match(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*$", line)
        if not item:
            continue
        value = item.group(2)
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1].replace('\\"', '"') if value[0] == '"' else value[1:-1].replace("''", "'")
        data[item.group(1)] = value
    return data


def find_post(slug: str) -> dict:
    for path in sorted(POSTS.glob("*.md")):
        data = front_matter(path)
        if data.get("slug") == slug or path.stem in {slug, f"{slug}-zh"} or path.stem.endswith(f"-{slug}-zh"):
            if data.get("published") == "false":
                raise ZhihuError(f"{path.name} 还没有公开（published: false），不同步。")
            permalink = data.get("permalink", "")
            if not permalink.startswith("/"):
                raise ZhihuError(f"{path.name} 没有 permalink，找不到它构建出来的页面。")
            return {"path": path, "slug": data.get("slug") or slug, "title": data.get("title", ""), "permalink": permalink, "data": data}
    raise ZhihuError(f"没有找到 slug 为 {slug!r} 的文章（_posts/*.md 的 slug 字段）。")


def built_page(post: dict) -> Path:
    page = SITE / post["permalink"].strip("/") / "index.html"
    if not page.is_file():
        raise ZhihuError(f"还没有构建出 {post['permalink']}：先运行 bundle exec jekyll build。")
    if post["path"].stat().st_mtime > page.stat().st_mtime + 1:
        raise ZhihuError(f"{post['path'].name} 比构建产物新：先运行 bundle exec jekyll build，再同步。")
    return page


def all_posts() -> list[dict]:
    posts = []
    for path in sorted(POSTS.glob("*.md"), reverse=True):
        data = front_matter(path)
        if data.get("published") != "false" and data.get("permalink", "").startswith("/"):
            posts.append({"path": path, "slug": data.get("slug", path.stem), "title": data.get("title", ""), "permalink": data["permalink"], "data": data})
    return posts


# ---------------------------------------------------------------- 转换：站内 HTML → 知乎 HTML


MATH = re.compile(
    r"\\\[(?P<block>.+?)\\\]"  # \[ … \]（kramdown 的行间公式）
    r"|\$\$(?P<block2>.+?)\$\$"
    r"|\\\((?P<inline>.+?)\\\)"
    r"|(?<![\\$\w])\$(?P<inline2>[^\s$](?:[^$\n]*?[^\s$\\])?)\$(?![\w$])",
    re.DOTALL,
)


def formula(tex: str, block: bool) -> str:
    """公式：<img eeimg>，alt 是 LaTeX 原文，src 是同一份字符串的 URL 编码（不去首尾空白）。"""
    return f'<img eeimg="{2 if block else 1}" src="//www.zhihu.com/equation?tex={quote(tex, safe="")}" alt="{escape(tex, quote=True)}" />'


def text_with_math(text: str) -> tuple[str, bool]:
    """转义正文文字，顺带把公式换成知乎公式图；返回 (html, 是否含行间公式)。"""
    out, last, has_block = [], 0, False
    for match in MATH.finditer(text):
        out.append(escape(text[last : match.start()], quote=False))
        block = match.group("block") if match.group("block") is not None else match.group("block2")
        if block is not None:
            has_block = True
            out.append(formula(block, True))
        else:
            out.append(formula(match.group("inline") if match.group("inline") is not None else match.group("inline2"), False))
        last = match.end()
    out.append(escape(text[last:], quote=False))
    return "".join(out), has_block


class ZhihuConverter(HTMLParser):
    """只转换 #markdown-content 里面的内容；输出只用 ZhihuPublisher 转换规范里列出的标签与属性。"""

    BLOCKS = {"p", "h2", "h3", "ul", "ol", "li", "blockquote", "pre", "table", "hr"}
    DROP = {"script", "style", "button", "svg", "noscript", "template", "iframe", "video", "audio", "object", "embed", "form", "input", "textarea", "select"}

    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.depth = 0  # #markdown-content 内的嵌套深度；0 表示不在正文里
        self.started = False
        self.out: list[str] = []
        self.stack: list[str] = []  # 实际输出的标签（用于收尾）
        self.tags: list[tuple[str, str]] = []  # (原标签, 输出的结束标签或 "")
        self.drop = 0
        self.pre: list[str] | None = None
        self.pre_lang = ""
        self.languages: list[str] = []
        self.quote_depth = 0
        self.quote_paragraphs = 0
        self.sticky = 0
        self.sticky_text: list[str] = []
        self.footnotes: dict[str, str] = {}
        self.footnote_order: list[str] = []
        self.in_footnotes = 0
        self.footnote_id = ""
        self.footnote_text: list[str] = []
        self.footnote_ref = ""
        self.images: list[dict] = []
        self.warnings: list[str] = []
        self.link_depth = 0
        self.table_rows_open = False

    # ---- 输出小工具
    def emit(self, html: str) -> None:
        if self.in_footnotes:
            if self.footnote_id:
                self.footnote_text.append(html)
            return
        if self.sticky:
            self.sticky_text.append(html)
            return
        self.out.append(html)

    def open_paragraph_if_bare(self) -> None:
        """正文顶层出现裸文字（如 kramdown 的行间公式）时补一个 <p>。"""
        if self.depth == 1 and not self.stack:
            self.emit("<p>")
            self.stack.append("p-auto")

    def close_auto_paragraph(self) -> None:
        if self.stack and self.stack[-1] == "p-auto":
            self.stack.pop()
            self.emit("</p>")

    # ---- HTMLParser 回调
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        classes = set(attributes.get("class", "").split())
        if not self.started:
            if attributes.get("id") == "markdown-content":
                self.started = True
                self.depth = 1
            return
        if self.depth == 0:
            return
        if tag not in {"br", "hr", "img", "input", "meta", "link", "source", "wbr", "col"}:
            self.depth += 1
        else:
            self._void(tag, attributes)
            return
        if self.drop or tag in self.DROP:
            if tag in {"iframe", "video", "audio", "embed", "object"}:
                self.warnings.append(f"知乎文章不支持 <{tag}>，已略去。")
            self.drop += 1
            self.tags.append((tag, "drop"))
            return
        if self.pre is not None:
            self.tags.append((tag, ""))
            return
        if self.depth == 2:
            self.close_auto_paragraph()

        end = ""
        if "footnotes" in classes:
            self.in_footnotes += 1
            end = "footnotes"
        elif self.in_footnotes:
            if tag == "li" and attributes.get("id", "").startswith("fn:"):
                self.footnote_id = attributes["id"][3:]
                self.footnote_text = []
                end = "footnote-li"
            elif tag == "a" and "reversefootnote" in classes:
                self.drop += 1
                end = "drop"
            elif tag == "a" and urlparse(urljoin(self.page_url, attributes.get("href", ""))).scheme in {"http", "https"}:
                self.emit(f'<a href="{escape(urljoin(self.page_url, attributes["href"]), quote=True)}">')
                end = "</a>"
        elif tag == "aside" and "sticky-note" in classes:
            self.sticky += 1
            self.sticky_text = []
            self.quote_paragraphs = 0
            end = "sticky"
        elif self.sticky and "sticky-note__by" in classes:
            self.drop += 1
            end = "drop"
        elif tag == "div" and any(name.startswith("language-") for name in classes):
            language = next(name for name in classes if name.startswith("language-"))[9:].lower()
            self.languages.append(LANGUAGE_IDS.get(language, language))
            end = "language"
        elif tag == "pre":
            self.pre = []
            self.pre_lang = self.languages[-1] if self.languages else ""
            end = "pre"
        elif tag == "p":
            if self.quote_depth or self.sticky:
                if self.quote_paragraphs:
                    self.emit("<br>")
                self.quote_paragraphs += 1
            else:
                self.emit("<p>")
                end = "</p>"
        elif tag in {"h1", "h2"}:
            self.emit("<h2>")
            end = "</h2>"
        elif tag == "h3":
            self.emit("<h3>")
            end = "</h3>"
        elif tag in {"h4", "h5", "h6"}:
            self.emit("<p><b>")
            end = "</b></p>"
        elif tag in {"strong", "b"}:
            self.emit("<b>")
            end = "</b>"
        elif tag in {"em", "i"}:
            self.emit("<i>")
            end = "</i>"
        elif tag == "code":
            self.emit("<code>")
            end = "</code>"
        elif tag in {"ul", "ol", "li"}:
            self.emit(f"<{tag}>")
            end = f"</{tag}>"
        elif tag == "blockquote":
            if not self.quote_depth:
                self.emit("<blockquote>")
                self.quote_paragraphs = 0
                end = "</blockquote>"
            self.quote_depth += 1
            end = end or "quote-inner"
        elif tag == "table":
            self.emit('<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal"><tbody>')
            end = "</tbody></table>"
        elif tag in {"tr", "th", "td"}:
            self.emit(f"<{tag}>")
            end = f"</{tag}>"
        elif tag == "sup" and attributes.get("role") == "doc-noteref":
            end = "noteref"
        elif tag == "a":
            href = attributes.get("href", "").strip()
            if "footnote" in classes and href.startswith("#fn:"):
                self.footnote_ref = href[4:]
                self.drop += 1
                end = "noteref-a"
            elif href.startswith("#") or not href:
                end = ""
            else:
                absolute = urljoin(self.page_url, href)
                if urlparse(absolute).scheme in {"http", "https"}:
                    self.emit(f'<a href="{escape(absolute, quote=True)}">')
                    end = "</a>"
        elif tag == "figcaption":
            end = "figcaption"
            self.caption: list[str] = []
        self.tags.append((tag, end))
        if end and end.startswith("</"):
            self.stack.append(end)

    def _void(self, tag: str, attributes: dict[str, str]) -> None:
        if self.drop:
            return
        if tag == "br":
            if self.pre is not None:
                self.pre.append("\n")
            else:
                self.emit("<br>")
        elif tag == "hr":
            self.close_auto_paragraph()
            self.emit("<hr />")
        elif tag == "img":
            src = attributes.get("src", "")
            if not src or src.startswith("data:"):
                self.warnings.append("略去了一张内嵌（data:）图片。")
                return
            index = len(self.images)
            self.images.append({"src": urljoin(self.page_url, src), "local": src, "alt": attributes.get("alt", ""), "caption": ""})
            self.open_paragraph_if_bare()
            self.emit(f"\x00IMG{index}\x00")

    def handle_endtag(self, tag: str) -> None:
        if self.depth == 0:
            return
        if tag in {"br", "hr", "img", "input", "meta", "link", "source", "wbr", "col"}:
            return
        self.depth -= 1
        if self.depth == 0:
            self.close_auto_paragraph()
            return
        if not self.tags:
            return
        _opened, end = self.tags.pop()
        if end == "drop":
            self.drop -= 1
            return
        if end == "noteref-a":
            # 脚注编号的链接文字被略去了，这里退出「略去」并留一个占位，收尾时换成知乎注释。
            self.drop -= 1
            key = self.footnote_ref
            if key not in self.footnote_order:
                self.footnote_order.append(key)
            self.emit(f"\x00FN{key}\x00")
            return
        if self.drop:
            return
        if end == "pre":
            code = "".join(self.pre or []).rstrip("\n")
            self.pre = None
            self.emit(f'<pre lang="{escape(self.pre_lang, quote=True)}">{escape(code, quote=False)}</pre>')
        elif self.pre is not None:
            return
        elif end == "language":
            self.languages.pop()
        elif end == "footnotes":
            self.in_footnotes -= 1
        elif end == "footnote-li":
            text = re.sub(r"<[^>]+>", "", "".join(self.footnote_text))
            self.footnotes[self.footnote_id] = re.sub(r"\s+", " ", text).strip()
            urls = re.findall(r'href="([^"]+)"', "".join(self.footnote_text))
            if len(urls) == 1:
                self.footnotes[self.footnote_id + "\x00url"] = urls[0]
            self.footnote_id = ""
        elif end == "sticky":
            self.sticky -= 1
            body = "".join(self.sticky_text).strip()
            self.quote_paragraphs = 0
            self.emit(f"<blockquote>便利贴（作者）：{body}</blockquote>")
        elif end == "quote-inner":
            self.quote_depth -= 1
        elif end == "</blockquote>":
            self.quote_depth -= 1
            self.stack.remove(end) if end in self.stack else None
            self.emit(end)
        elif end == "figcaption":
            if self.images:
                self.images[-1]["caption"] = re.sub(r"\s+", " ", "".join(self.caption)).strip()[:140]
        elif end.startswith("</"):
            if end in self.stack:
                self.stack.remove(end)
            self.emit(end)

    def handle_data(self, data: str) -> None:
        if self.depth == 0 or self.drop:
            return
        if self.pre is not None:
            self.pre.append(data)
            return
        if self.tags and self.tags[-1][1] == "figcaption":
            self.caption.append(data)
            return
        if self.in_footnotes and not self.footnote_id:
            return
        if not data.strip():
            if self.stack or self.in_footnotes or self.sticky:
                self.emit(escape(data, quote=False) if data == " " else (" " if self.stack else ""))
            return
        inside_code = any(end == "</code>" for _tag, end in self.tags)
        if inside_code:
            self.emit(escape(data, quote=False))
            return
        html, _has_block = text_with_math(data)
        self.open_paragraph_if_bare()
        self.emit(html)

    # ---- 收尾
    def result(self) -> str:
        html = "".join(self.out)
        numbers = {key: str(i + 1) for i, key in enumerate(self.footnote_order)}

        def note(match: re.Match) -> str:
            key = match.group(1)
            text = self.footnotes.get(key, "")
            url = self.footnotes.get(key + "\x00url", "")
            n = numbers.get(key, "?")
            return (
                f'<sup data-text="{escape(text, quote=True)}" data-url="{escape(url, quote=True)}" '
                f'data-draft-node="inline" data-draft-type="reference" data-numero="{n}">[{n}]</sup>'
            )

        html = re.sub(r"\x00FN(.+?)\x00", note, html)
        html = re.sub(r"<p>\s*</p>", "", html)
        html = re.sub(r"\n{2,}", "\n", html)
        return html.strip()


def convert(post: dict, footer: bool = True) -> dict:
    page = built_page(post)
    url = SITE_URL + post["permalink"]
    converter = ZhihuConverter(url)
    converter.feed(page.read_text(encoding="utf-8"))
    converter.close()
    if not converter.started:
        raise ZhihuError(f"{page.relative_to(ROOT)} 里没有 #markdown-content。")
    body = converter.result()
    if footer:
        body += f'<hr /><p>本文首发于我的个人网站 <a href="{escape(url, quote=True)}">Function</a>，那边的版本会持续更新。</p>'
    title = post["title"].strip()
    plain = re.sub(r"<[^>]+>", "", body)
    if not title or "\n" in title or len(title) > 100:
        raise ZhihuError(f"知乎文章标题必须是 1–100 字、不换行（现在 {len(title)} 字）。")
    if len(plain) < 9 or len(plain) > 100000:
        raise ZhihuError(f"知乎文章正文要在 9 到 10 万字之间（现在 {len(plain)} 字）。")
    return {"title": title, "body": body, "images": converter.images, "warnings": converter.warnings, "url": url}


def fingerprint(title: str, body: str) -> str:
    """同步状态只看转换结果：标题 + 正文（图片用占位符，不受上传地址影响）。"""
    return hashlib.sha256(f"{title}\n{body}".encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- 图片：官方媒体云


def upload_images(article: dict, credentials: tuple[str, str]) -> str:
    body = article["body"]
    if not article["images"]:
        return body
    try:
        from mediacloud_uploader import MediaCloudUploader  # type: ignore
    except ImportError as error:
        raise ZhihuError(
            f"这篇文章有 {len(article['images'])} 张图片，知乎要求先上传到媒体云。请安装官方上传 SDK：\n"
            "  pip install git+https://github.com/zhihu/zhihu-mediacloud-uploader\n"
            "安装后重试；不会用原始图片地址代替。"
        ) from error
    cache_path = OUT / "images.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    uploader = MediaCloudUploader(app_key=credentials[0], app_secret=credentials[1], base_url=OPENAPI_BASE)
    for index, image in enumerate(article["images"]):
        local = SITE / urlparse(image["src"]).path.lstrip("/") if image["src"].startswith(SITE_URL) else None
        source = local if local and local.is_file() else None
        key = hashlib.sha256(source.read_bytes()).hexdigest() if source else image["src"]
        if key not in cache:
            print(f"  上传图片 {index + 1}/{len(article['images'])}：{image['local']}")
            response = uploader.upload_image(file_path=str(source), scene_name="article") if source else uploader.upload_image(url=image["src"], scene_name="article")
            if not getattr(response, "is_success", False) or not response.media_url or not response.media_url.primary:
                raise ZhihuError(f"图片上传失败：{image['local']}（没有拿到知乎媒体地址），已停止。")
            watermark = response.extra.watermark_image_url.primary if getattr(response, "extra", None) and response.extra.watermark_image_url else ""
            meta = response.media_meta
            cache[key] = {"src": watermark or response.media_url.primary, "original": response.media_url.primary, "watermark": watermark, "width": getattr(meta, "width", 0), "height": getattr(meta, "height", 0)}
            OUT.mkdir(exist_ok=True)
            cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        uploaded = cache[key]
        attributes = [f'src="{escape(uploaded["src"], quote=True)}"', f'data-caption="{escape(image["caption"], quote=True)}"']
        width = int(uploaded.get("width") or 0)
        attributes.append(f'data-size="{"normal" if width >= 343 or not width else "small"}"')
        if width and uploaded.get("height"):
            attributes += [f'data-rawwidth="{width}"', f'data-rawheight="{int(uploaded["height"])}"']
        attributes += [f'data-original-src="{escape(uploaded["original"], quote=True)}"', f'data-watermark-src="{escape(uploaded["watermark"], quote=True)}"']
        body = body.replace(f"\x00IMG{index}\x00", f"<img {' '.join(attributes)} />")
    return body


def preview_images(article: dict) -> str:
    body = article["body"]
    for index, image in enumerate(article["images"]):
        local = SITE / urlparse(image["src"]).path.lstrip("/")
        src = local.as_uri() if image["src"].startswith(SITE_URL) and local.is_file() else image["src"]
        body = body.replace(f"\x00IMG{index}\x00", f'<img src="{escape(src, quote=True)}" alt="{escape(image["alt"], quote=True)}" data-caption="{escape(image["caption"], quote=True)}" />')
    return body


# ---------------------------------------------------------------- 本地预览


PREVIEW_STYLE = """
:root { color-scheme: light; }
body { margin: 0; background: #f6f6f6; font: 15px/1.67 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #121212; }
.bar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ebebeb; padding: 10px 20px; font-size: 13px; color: #8590a6; }
.bar b { color: #121212; font-weight: 600; }
main { max-width: 690px; margin: 24px auto 80px; background: #fff; padding: 40px 48px 56px; border-radius: 2px; }
h1 { font-size: 26px; line-height: 1.4; margin: 0 0 28px; }
h2 { font-size: 22px; margin: 36px 0 14px; } h3 { font-size: 18px; margin: 28px 0 12px; }
p { margin: 0 0 20px; } blockquote { margin: 0 0 20px; padding: 0 0 0 12px; border-left: 3px solid #d3d3d3; color: #646464; }
pre { background: #f8f8fa; padding: 14px 16px; overflow: auto; font-size: 13px; border-radius: 4px; }
pre::before { content: attr(lang); display: block; color: #8590a6; font-size: 11px; margin-bottom: 6px; }
code { background: #f8f8fa; padding: 1px 4px; border-radius: 3px; font-size: 13px; }
table { border-collapse: collapse; margin: 0 0 20px; } th, td { border: 1px solid #ebebeb; padding: 6px 10px; } th { background: #f8f8fa; }
img { max-width: 100%; } img[eeimg="1"] { vertical-align: middle; } img[eeimg="2"] { display: block; margin: 12px auto; }
sup[data-numero] { color: #175199; cursor: help; } hr { border: 0; border-top: 1px solid #ebebeb; margin: 32px 0; }
a { color: #175199; text-decoration: none; border-bottom: 1px solid #b8c6dd; }
"""


def write_preview(post: dict, article: dict, body: str) -> Path:
    folder = OUT / post["slug"]
    folder.mkdir(parents=True, exist_ok=True)
    preview_body = body.replace('src="//www.zhihu.com/equation', 'src="https://www.zhihu.com/equation')
    preview_body = re.sub(r'<sup data-text="([^"]*)"', r'<sup title="\1" data-text="\1"', preview_body)
    page = (
        f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>知乎预览 · {escape(article["title"])}</title>'
        f"<style>{PREVIEW_STYLE}</style></head><body>"
        f'<div class="bar"><b>本地预览</b> · 这就是要发到知乎的内容（{len(re.sub(r"<[^>]+>", "", body))} 字，'
        f'{len(article["images"])} 张图片）· 原文 {escape(article["url"])}</div>'
        f'<main><h1>{escape(article["title"])}</h1>{preview_body}</main></body></html>'
    )
    path = folder / "preview.html"
    path.write_text(page, encoding="utf-8")
    (folder / "article.html").write_text(body + "\n", encoding="utf-8")
    return path


# ---------------------------------------------------------------- 同步记录


def load_sync() -> dict:
    if not SYNC_FILE.exists():
        return {}
    return json.loads(SYNC_FILE.read_text(encoding="utf-8"))


def save_sync(data: dict) -> None:
    ordered = {key: data[key] for key in sorted(data)}
    SYNC_FILE.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def now_cst() -> str:
    return datetime.now(CST).replace(microsecond=0).isoformat()


def zhihu_id(url: str) -> str:
    match = re.match(r"^https://zhuanlan\.zhihu\.com/p/(\d+)/?$", url.strip())
    if not match:
        raise ZhihuError(f"不是知乎专栏文章链接：{url}（应形如 https://zhuanlan.zhihu.com/p/123456）")
    return match.group(1)


# ---------------------------------------------------------------- 凭证（不打印、不落盘）


def keychain(account: str) -> str:
    if sys.platform != "darwin" or not shutil.which("security"):
        return ""
    result = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ""


def openapi_credentials() -> tuple[tuple[str, str], str]:
    sources = [
        ("环境变量", os.environ.get("ZHIHU_OPENAPI_APP_KEY", ""), os.environ.get("ZHIHU_OPENAPI_APP_SECRET", "")),
        ("钥匙串", keychain("openapi-app-key"), keychain("openapi-app-secret")),
    ]
    if SHARED_CREDENTIALS.is_file():
        try:
            shared = json.loads(SHARED_CREDENTIALS.read_text(encoding="utf-8"))
            sources.append(("~/.zhihu/openapi-credentials.json", shared.get("ZHIHU_OPENAPI_APP_KEY", ""), shared.get("ZHIHU_OPENAPI_APP_SECRET", "")))
        except (OSError, json.JSONDecodeError):
            pass
    for name, key, secret in sources:
        if key and secret:
            return (key, secret), name
    raise ZhihuError(
        "没有找到知乎开放平台凭证。先在 https://www.zhihu.com/playground/zhihu-publisher 申请访问密钥，"
        "然后运行 python3 scripts/zhihu.py login openapi 存进钥匙串。"
    )


def web_cookie() -> tuple[str, str]:
    for name, value in (("环境变量", os.environ.get("ZHIHU_COOKIE", "")), ("钥匙串", keychain("web-cookie"))):
        if value:
            if "z_c0=" not in value or "_xsrf=" not in value:
                raise ZhihuError(f"{name}里的知乎 Cookie 缺少 z_c0 或 _xsrf，请重新运行 login cookie。")
            return value, name
    raise ZhihuError("没有找到知乎网页 Cookie：运行 python3 scripts/zhihu.py login cookie（只用于存草稿）。")


def sign(app_key: str, secret: str, timestamp: str, log_id: str, extra: str = "") -> str:
    message = f"app_key:{app_key}|ts:{timestamp}|logid:{log_id}|extra_info:{extra}"
    return base64.b64encode(hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()).decode("ascii")


# ---------------------------------------------------------------- 交互


def ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except EOFError:
        return ""


def choose(title: str, choices: list[tuple[str, str]], default: int = 0) -> str:
    print(f"\n{title}")
    for i, (label, _value) in enumerate(choices, 1):
        print(f"  {i}. {label}{'（默认）' if i - 1 == default else ''}")
    answer = ask(f"选择 1–{len(choices)}，直接回车用默认：")
    if not answer:
        return choices[default][1]
    if answer.isdigit() and 1 <= int(answer) <= len(choices):
        return choices[int(answer) - 1][1]
    for label, value in choices:
        if answer == label:
            return value
    raise ZhihuError(f"没有「{answer}」这个选项，已停止，什么都没发。")


def topics_from(text: str) -> list[dict]:
    tokens: list[str] = []
    for token in re.findall(r"zhihu\.com/topic/(\d+)", text):
        if token not in tokens:
            tokens.append(token)
    if text.strip() and not tokens:
        raise ZhihuError("没能从输入里认出知乎话题链接（形如 https://www.zhihu.com/topic/19555547/hot），已停止。")
    return [{"topic_id": "", "topic_token": token, "topic_name": ""} for token in tokens[:3]]


def daily_count() -> int:
    today = datetime.now(CST).date().isoformat()
    try:
        log = json.loads(PUBLISH_LOG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        log = []
    return sum(1 for item in log if str(item).startswith(today))


def log_publish() -> None:
    try:
        log = json.loads(PUBLISH_LOG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        log = []
    log = [item for item in log if str(item) >= (datetime.now(CST) - timedelta(days=7)).isoformat()] + [now_cst()]
    PUBLISH_LOG.parent.mkdir(parents=True, exist_ok=True)
    PUBLISH_LOG.write_text(json.dumps(log) + "\n", encoding="utf-8")


def http_json(method: str, url: str, headers: dict[str, str], body: dict | None = None) -> tuple[int, dict | None, str]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(request, timeout=30) as response:
            status, text = response.status, response.read().decode("utf-8", "replace")
    except HTTPError as error:
        status, text = error.code, error.read().decode("utf-8", "replace")
    except URLError as error:
        raise ZhihuError(f"连不上 {urlparse(url).netloc}：{error.reason}") from error
    try:
        return status, json.loads(text), text
    except json.JSONDecodeError:
        return status, None, text


# ---------------------------------------------------------------- 命令


def cmd_preview(args: argparse.Namespace) -> int:
    post = find_post(args.slug)
    article = convert(post, footer=not args.no_footer)
    path = write_preview(post, article, preview_images(article))
    for warning in article["warnings"]:
        print(f"注意：{warning}")
    print(f"预览：{path}\n知乎 HTML：{path.with_name('article.html')}")
    if not args.no_open:
        webbrowser.open(path.as_uri())
    return 0


def cmd_publish(args: argparse.Namespace) -> int:
    post = find_post(args.slug)
    sync = load_sync()
    existing = sync.get(post["permalink"], {}).get("zhihu")
    if existing:
        raise ZhihuError(f"这篇已经发到知乎：{existing['url']}。文章改过的话用 draft 存成草稿再在知乎点「发布更新」。")
    if daily_count() >= DAILY_LIMIT:
        raise ZhihuError(f"今天已经通过官方接口发布了 {DAILY_LIMIT} 次（知乎的上限），明天再来。")
    credentials, source = openapi_credentials()
    article = convert(post, footer=not args.no_footer)
    for warning in article["warnings"]:
        print(f"注意：{warning}")
    body = upload_images(article, credentials)
    preview = write_preview(post, article, body)
    print(f"《{article['title']}》→ 知乎专栏（凭证来自{source}）")
    print(f"预览已生成：{preview}")
    if not args.no_open:
        webbrowser.open(preview.as_uri())

    comment = args.comment or choose("评论权限", COMMENT_CHOICES)
    topics = topics_from(args.topics if args.topics is not None else ask("\n关联话题（可选，最多 3 个）：粘贴知乎话题链接，如 https://www.zhihu.com/topic/19555547/hot，直接回车跳过：\n"))
    statement = args.statement if args.statement is not None else choose("创作声明（这篇如果有 AI 辅助代写、改写或成段润色，建议选 6）", STATEMENT_CHOICES)
    toc = args.toc

    content = {"title": article["title"], "html": body, "comment_permission": comment, "table_of_contents_enabled": toc}
    if statement:
        content["creation_statement"] = statement
    if topics:
        content["topics"] = topics
    request_body = {"type": "article", "confirmed": True, "confirm_note": "confirmed by user after local preview", "content": content}
    folder = OUT / post["slug"]
    (folder / "request.json").write_text(json.dumps(request_body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    labels = dict((value, label) for label, value in COMMENT_CHOICES)
    print("\n即将发布（知乎官方接口没有草稿，发出即公开）：")
    print(f"  标题：{article['title']}\n  正文：{len(re.sub(r'<[^>]+>', '', body))} 字，{len(article['images'])} 张图片")
    print(f"  评论：{labels[comment]} · 话题：{', '.join(t['topic_token'] for t in topics) or '无'} · 声明：{dict((v, l) for l, v in STATEMENT_CHOICES)[statement]} · 目录：{'创建' if toc else '不创建'}")
    if ask("确认预览没问题，输入「发布」发送，其他任何输入都取消：") != "发布":
        print("已取消，什么都没发。")
        return 1

    timestamp, log_id = str(int(time.time())), f"functionhx-{post['slug']}-{int(time.time() * 1000)}"
    headers = {
        "Content-Type": "application/json",
        "X-App-Key": credentials[0],
        "X-Timestamp": timestamp,
        "X-Log-Id": log_id,
        "X-Extra-Info": "",
        "X-Sign": sign(credentials[0], credentials[1], timestamp, log_id),
        "User-Agent": "functionhx-zhihu-sync/1",
    }
    status, payload, text = http_json("POST", f"{OPENAPI_BASE}/openapi/publish", headers, request_body)
    (folder / "response.json").write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")
    log_publish()
    if not isinstance(payload, dict) or payload.get("status") != 0:
        message = payload.get("msg") if isinstance(payload, dict) else "返回的不是 JSON"
        raise ZhihuError(f"发布失败（HTTP {status}）：{message}。完整响应在 {folder / 'response.json'}")
    data = payload.get("data") or {}
    url = data.get("url", "")
    sync.setdefault(post["permalink"], {})["zhihu"] = {
        "url": url,
        "id": str(data.get("content_token", "")),
        "published_at": now_cst(),
        "fingerprint": fingerprint(article["title"], article["body"]),
        "via": "openapi",
    }
    save_sync(sync)
    print(f"已发布：{url}\n已记进 _data/syndication.json，提交后文章页会出现「同步于知乎」。")
    return 0


def cmd_draft(args: argparse.Namespace) -> int:
    post = find_post(args.slug)
    sync = load_sync()
    entry = sync.get(post["permalink"], {}).get("zhihu")
    if not entry:
        raise ZhihuError("这篇还没发到知乎：首发用 publish（官方接口），或用 link 补上已有的知乎文章。")
    article = convert(post, footer=not args.no_footer)
    current = fingerprint(article["title"], article["body"])
    if current == entry.get("fingerprint"):
        print("知乎上的版本和博客一致，不需要更新。")
        return 0
    if current == entry.get("draft_fingerprint"):
        print(f"这个版本已经存成草稿了：去 {WEB_BASE}/p/{entry['id']}/edit 点「发布更新」，然后运行 synced {post['slug']}。")
        return 0
    cookie, source = web_cookie()
    xsrf = re.search(r"(?:^|;\s*)_xsrf=([^;]+)", cookie).group(1)
    credentials = None
    if article["images"]:
        credentials, _ = openapi_credentials()
    body = upload_images(article, credentials) if credentials else article["body"]
    preview = write_preview(post, article, body)
    print(f"《{article['title']}》的新版本 → 知乎草稿 {entry['url']}（Cookie 来自{source}）\n预览：{preview}")
    if not args.no_open:
        webbrowser.open(preview.as_uri())
    if ask("只存草稿、不会发布。输入「草稿」继续，其他任何输入都取消：") != "草稿":
        print("已取消。")
        return 1
    headers = {
        "Content-Type": "application/json",
        "Cookie": cookie,
        "x-xsrftoken": xsrf,
        "x-requested-with": "fetch",
        "Origin": "https://zhuanlan.zhihu.com",
        "Referer": f"https://zhuanlan.zhihu.com/p/{entry['id']}/edit",
        "User-Agent": USER_AGENT,
    }
    status, payload, text = http_json("PATCH", f"{WEB_BASE}/api/articles/{entry['id']}/draft", headers, {"title": article["title"], "content": body, "table_of_contents": False})
    if not 200 <= status < 300:
        detail = (payload or {}).get("error", {}).get("message") if isinstance(payload, dict) else text[:200]
        raise ZhihuError(f"存草稿失败（HTTP {status}）：{detail or '未知原因'}。Cookie 过期就重新 login cookie；接口变了的话请手动在知乎更新。")
    entry["draft_fingerprint"] = current
    entry["draft_at"] = now_cst()
    save_sync(sync)
    print(f"草稿已存好：去 {WEB_BASE}/p/{entry['id']}/edit 检查并点「发布更新」，然后运行 python3 scripts/zhihu.py synced {post['slug']}。")
    return 0


def cmd_synced(args: argparse.Namespace) -> int:
    post = find_post(args.slug)
    sync = load_sync()
    entry = sync.get(post["permalink"], {}).get("zhihu")
    if not entry or not entry.get("draft_fingerprint"):
        raise ZhihuError("没有待发布的草稿记录。")
    entry["fingerprint"] = entry.pop("draft_fingerprint")
    entry.pop("draft_at", None)
    entry["updated_at"] = now_cst()
    save_sync(sync)
    print("已记下：知乎上的版本和博客一致了。")
    return 0


def cmd_link(args: argparse.Namespace) -> int:
    post = find_post(args.slug)
    article = convert(post, footer=not args.no_footer)
    sync = load_sync()
    sync.setdefault(post["permalink"], {})["zhihu"] = {
        "url": f"https://zhuanlan.zhihu.com/p/{zhihu_id(args.url)}",
        "id": zhihu_id(args.url),
        "published_at": now_cst(),
        "fingerprint": fingerprint(article["title"], article["body"]),
        "via": "manual",
    }
    save_sync(sync)
    print(f"已关联 {post['permalink']} → {sync[post['permalink']]['zhihu']['url']}（视为知乎上就是当前版本）。")
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    sync = load_sync()
    for post in all_posts():
        entry = sync.get(post["permalink"], {}).get("zhihu")
        if not entry:
            state = "未同步"
        else:
            try:
                article = convert(post)
                current = fingerprint(article["title"], article["body"])
                if current == entry.get("fingerprint"):
                    state = "已同步"
                elif current == entry.get("draft_fingerprint"):
                    state = "草稿已推送，待你在知乎点「发布更新」"
                else:
                    state = "博客改过了，运行 draft 更新"
            except ZhihuError as error:
                state = f"无法比较：{error}"
        print(f"{post['slug']:<32} {state}{'  ' + entry['url'] if entry else ''}")
    return 0


def cmd_login(args: argparse.Namespace) -> int:
    if sys.platform != "darwin" or not shutil.which("security"):
        raise ZhihuError("钥匙串只在 macOS 上可用；其他系统请用环境变量 ZHIHU_OPENAPI_APP_KEY / ZHIHU_OPENAPI_APP_SECRET / ZHIHU_COOKIE。")
    if args.kind == "openapi":
        key = ask("知乎用户 Token（个人主页 https://www.zhihu.com/people/<这里> 的那段）：")
        if not re.fullmatch(r"[\w.-]{1,80}", key):
            raise ZhihuError("这不像知乎主页里的用户名。")
        subprocess.run(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", "openapi-app-key", "-w", key], check=True)
        print("接下来由 macOS 的 security 命令提示输入访问密钥（输入时不显示，需要输两次）。")
        subprocess.run(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", "openapi-app-secret", "-w"], check=True)
    else:
        print("在浏览器登录知乎后，从开发者工具复制整段 Cookie（至少含 z_c0 与 _xsrf）。")
        print("接下来由 macOS 的 security 命令提示粘贴（输入时不显示，需要输两次）。")
        subprocess.run(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", "web-cookie", "-w"], check=True)
    print(f"已存进钥匙串（服务名 {KEYCHAIN_SERVICE}）。运行 doctor 检查。")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    ok = True
    try:
        (key, _secret), source = openapi_credentials()
        print(f"✓ 开放平台凭证：来自{source}（用户 {key}）")
    except ZhihuError as error:
        ok = False
        print(f"✗ 开放平台凭证：{error}")
    try:
        _cookie, source = web_cookie()
        print(f"✓ 网页 Cookie：来自{source}（只用于存草稿）")
    except ZhihuError as error:
        print(f"· 网页 Cookie：{error}")
    try:
        import mediacloud_uploader  # type: ignore  # noqa: F401

        print("✓ 官方媒体云上传 SDK 已安装（有图片的文章可以发）")
    except ImportError:
        print("· 官方媒体云上传 SDK 未安装：没有图片的文章不受影响")
    print(f"{'✓' if SITE.is_dir() else '✗'} 构建产物 _site{'' if SITE.is_dir() else '：先 bundle exec jekyll build'}")
    if args.online:
        status, payload, _text = http_json("GET", f"{OPENAPI_BASE}/openapi/publish_skill/version", {"User-Agent": "functionhx-zhihu-sync/1"})
        print(f"{'✓' if status == 200 else '✗'} 官方接口可达：HTTP {status}{'，最新 skill 版本 ' + str(payload) if isinstance(payload, dict) else ''}")
        try:
            cookie, _ = web_cookie()
            status, payload, _text = http_json("GET", "https://www.zhihu.com/api/v4/me", {"Cookie": cookie, "User-Agent": USER_AGENT})
            name = payload.get("name") if isinstance(payload, dict) else None
            print(f"{'✓' if status == 200 and name else '✗'} Cookie 登录状态：{'已登录为 ' + name if name else 'HTTP ' + str(status) + '，可能已过期'}")
        except ZhihuError:
            pass
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="zhihu.py", description="把博客文章同步到知乎专栏（官方接口首发，Cookie 草稿兜底）。")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, handler, helptext in (
        ("preview", cmd_preview, "转换并打开本地预览"),
        ("publish", cmd_publish, "首发：官方 Publish OpenAPI（预览确认后才发）"),
        ("draft", cmd_draft, "已发布的文章改过之后：存成知乎草稿"),
        ("synced", cmd_synced, "在知乎点了「发布更新」之后记一笔"),
        ("link", cmd_link, "关联一篇手动发到知乎的文章"),
    ):
        command = sub.add_parser(name, help=helptext)
        command.add_argument("slug")
        if name == "link":
            command.add_argument("url")
        command.add_argument("--no-footer", action="store_true", help="不在文末加「本文首发于 Function」")
        command.add_argument("--no-open", action="store_true", help="不自动打开预览")
        if name == "publish":
            command.add_argument("--comment", choices=[value for _label, value in COMMENT_CHOICES])
            command.add_argument("--topics", help="知乎话题链接，可多个；给空字符串表示不关联")
            command.add_argument("--statement", choices=[value for _label, value in STATEMENT_CHOICES])
            command.add_argument("--toc", action="store_true", help="创建文章目录")
        command.set_defaults(handler=handler)
    sub.add_parser("status", help="每篇文章的同步状态").set_defaults(handler=cmd_status)
    login = sub.add_parser("login", help="把凭证存进 macOS 钥匙串")
    login.add_argument("kind", choices=["openapi", "cookie"])
    login.set_defaults(handler=cmd_login)
    doctor = sub.add_parser("doctor", help="检查凭证、构建产物与依赖")
    doctor.add_argument("--online", action="store_true", help="顺便检查官方接口与 Cookie 是否可用")
    doctor.set_defaults(handler=cmd_doctor)
    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except ZhihuError as error:
        print(f"zhihu.py：{error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\n已中断，什么都没发。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
