#!/usr/bin/env python3
"""scripts/zhihu.py：转换规则、签名、官方接口首发、Cookie 草稿兜底，全部对着本地假服务跑，不碰真知乎。"""

from __future__ import annotations

import base64
import builtins
import hashlib
import hmac
import importlib.util
import io
import json
import os
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("zhihu", ROOT / "scripts" / "zhihu.py")
zhihu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zhihu)

SECRET = "not-a-real-zhihu-secret"
COOKIE = "z_c0=not-a-real-z_c0; _xsrf=not-a-real-xsrf; d_c0=x"


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


# ---------------------------------------------------------------- 假站点

PAGE = """<!doctype html><html><body><nav>不在正文里</nav>
<div id="markdown-content">
<h1 id="a">副标题</h1>
<p>普通段落，<strong>加粗</strong>与<em>斜体</em>，<code>inline &lt;code&gt;</code>，
<a href="/blog/other/">站内链接</a>、<a href="#a">锚点</a>和<a href="https://example.com/x?a=1&amp;b=2">外链</a>。</p>
<p>价格 $5 和 $10 不是公式；行内公式 $E=mc^2$ 是。</p>
\\[ \\sum_{i=1}^n i \\]
<h4 id="b">四级标题</h4>
<blockquote><p>引用第一段</p><p>引用第二段</p></blockquote>
<aside class="sticky-note sticky-note--author" data-sticky-color="pink" role="note"><span class="sticky-note__by" aria-hidden="true">ƒ 作者</span><p>作者的便利贴</p></aside>
<div class="language-python highlighter-rouge"><div class="highlight"><pre class="highlight"><code><span class="k">def</span> <span class="nf">f</span><span class="p">():</span>
    <span class="k">return</span> <span class="mi">1</span> <span class="o">&lt;</span> <span class="mi">2</span>
</code></pre></div></div>
<table><thead><tr><th>列 A</th><th style="text-align: right">列 B</th></tr></thead><tbody><tr><td>1</td><td style="text-align: right">2</td></tr></tbody></table>
<p>带脚注的句子<sup id="fnref:n" role="doc-noteref"><a href="#fn:n" class="footnote" rel="footnote">1</a></sup>。</p>
<ul><li>一</li><li>二</li></ul>
<script>alert(1)</script><iframe src="https://example.com"></iframe>
<div class="footnotes" role="doc-endnotes"><ol><li id="fn:n"><p>脚注说明 <a href="https://ref.example.com">来源</a> <a href="#fnref:n" class="reversefootnote">↩</a></p></li></ol></div>
</div><footer>页脚</footer></body></html>"""


def make_site(root: Path, page: str = PAGE, slug: str = "demo") -> None:
    (root / "_posts").mkdir(parents=True)
    (root / "_data").mkdir()
    (root / "_posts" / f"2026-10-07-{slug}-zh.md").write_text(
        f'---\nlayout: post\ntitle: "测试文章：知乎同步"\nslug: "{slug}"\npublished: true\npermalink: /blog/2026/{slug}/\n---\n正文\n', encoding="utf-8"
    )
    built = root / "_site" / "blog" / "2026" / slug
    built.mkdir(parents=True)
    (built / "index.html").write_text(page, encoding="utf-8")
    (root / "_data" / "syndication.json").write_text("{}\n", encoding="utf-8")


def point_at(root: Path) -> None:
    zhihu.ROOT, zhihu.SITE, zhihu.POSTS = root, root / "_site", root / "_posts"
    zhihu.SYNC_FILE, zhihu.OUT = root / "_data" / "syndication.json", root / ".zhihu-out"
    zhihu.PUBLISH_LOG = root / "publish-log.json"
    zhihu.SHARED_CREDENTIALS = root / "no-shared-credentials.json"
    zhihu.keychain = lambda _account: ""  # 测试不读真钥匙串


def run(args: list[str], answers: list[str]) -> tuple[int, str]:
    queue = list(answers)
    original = builtins.input
    builtins.input = lambda _prompt="": queue.pop(0) if queue else ""
    buffer = io.StringIO()
    try:
        with redirect_stdout(buffer):
            code = zhihu.main(args)
    finally:
        builtins.input = original
    return code, buffer.getvalue()


# ---------------------------------------------------------------- 假知乎


class Recorder(BaseHTTPRequestHandler):
    requests: list[dict] = []
    reply = {"status": 0, "msg": "success", "data": {"type": "article", "content_token": "998877", "url": "https://zhuanlan.zhihu.com/p/998877"}}

    def handle_any(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else ""
        Recorder.requests.append({"method": self.command, "path": self.path, "headers": dict(self.headers), "raw_headers": self.headers, "body": body})
        payload = json.dumps(Recorder.reply if self.path == "/openapi/publish" else {"updated": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_POST = do_PATCH = do_PUT = do_GET = handle_any

    def log_message(self, *_args) -> None:
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Recorder)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}"
zhihu.OPENAPI_BASE = BASE
zhihu.WEB_BASE = BASE
zhihu.webbrowser.open = lambda *_args, **_kwargs: True

# ---------------------------------------------------------------- 1. 签名与官方模板一致

expected = subprocess.run(
    "printf 'app_key:%s|ts:%s|logid:%s|extra_info:%s' functionhx 1760000000 log-1 '' | openssl dgst -sha256 -hmac " + SECRET + " -binary | base64",
    shell=True,
    capture_output=True,
    text=True,
).stdout.strip()
check(zhihu.sign("functionhx", SECRET, "1760000000", "log-1") == expected, "signature matches the official curl template")

# ---------------------------------------------------------------- 2. 转换

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    make_site(root)
    point_at(root)
    article = zhihu.convert(zhihu.find_post("demo"))
    html = article["body"]
    check("不在正文里" not in html and "页脚" not in html, "only #markdown-content is converted")
    check("<h2>副标题</h2>" in html, "h1 inside the body becomes h2")
    check("<p><b>四级标题</b></p>" in html, "h4 becomes a bold paragraph")
    check("<b>加粗</b>" in html and "<i>斜体</i>" in html, "strong/em become b/i")
    check("<code>inline &lt;code&gt;</code>" in html, "inline code is escaped")
    check('<a href="https://functionhx.github.io/blog/other/">站内链接</a>' in html, "site links become absolute")
    check("锚点" in html and 'href="#a"' not in html, "in-page anchors keep their text but lose the link")
    check('href="https://example.com/x?a=1&amp;b=2"' in html, "external links keep their query, escaped")
    check("价格 $5 和 $10 不是公式" in html, "prices are not formulas")
    check('<img eeimg="1" src="//www.zhihu.com/equation?tex=E%3Dmc%5E2" alt="E=mc^2" />' in html, "inline math becomes eeimg=1")
    check('<img eeimg="2" src="//www.zhihu.com/equation?tex=%20%5Csum_%7Bi%3D1%7D%5En%20i%20" alt=" \\sum_{i=1}^n i " />' in html, "block math keeps its inner spaces")
    check("<blockquote>引用第一段<br>引用第二段</blockquote>" in html, "quote paragraphs are joined with <br>")
    check("<blockquote>便利贴（作者）：作者的便利贴</blockquote>" in html and "ƒ 作者" not in html, "author sticky notes become signed quotes")
    check('<pre lang="python">def f():\n    return 1 &lt; 2</pre>' in html, "code blocks are <pre lang> with plain escaped text")
    check('<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal"><tbody><tr><th>列 A</th>' in html, "tables use the draft attributes and one tbody")
    check(" style=" not in html and "<thead>" not in html, "no style attributes or thead")
    check(
        '<sup data-text="脚注说明 来源" data-url="https://ref.example.com" data-draft-node="inline" data-draft-type="reference" data-numero="1">[1]</sup>' in html,
        "footnotes become Zhihu references",
    )
    check("↩" not in html and "doc-endnotes" not in html, "the footnote list itself is not repeated")
    check("<ul><li>一</li><li>二</li></ul>" in html, "lists survive")
    check("alert" not in html and "<iframe" not in html and "<script" not in html, "scripts and iframes are dropped")
    check(any("iframe" in warning for warning in article["warnings"]), "dropped embeds are reported")
    check(html.endswith('那边的版本会持续更新。</p>') and "https://functionhx.github.io/blog/2026/demo/" in html, "the first-published-at footer links back")
    allowed = {"p", "h2", "h3", "b", "i", "code", "a", "blockquote", "br", "hr", "pre", "img", "table", "tbody", "tr", "th", "td", "ul", "ol", "li", "sup"}
    import re

    used = set(re.findall(r"<(\w+)", html))
    check(used <= allowed, f"only whitelisted tags: {sorted(used - allowed)}")

    # 有图片、没装官方上传 SDK：停下，不拿原始地址凑合
    with_image = PAGE.replace("<ul>", '<p><img src="/assets/img/x.png" alt="x"></p><ul>')
    (root / "_site" / "blog" / "2026" / "demo" / "index.html").write_text(with_image, encoding="utf-8")
    try:
        zhihu.upload_images(zhihu.convert(zhihu.find_post("demo")), ("functionhx", SECRET))
        raise AssertionError("an article with images must not go out without the media-cloud uploader")
    except zhihu.ZhihuError as error:
        check("zhihu-mediacloud-uploader" in str(error), "the error says how to install the uploader")

# ---------------------------------------------------------------- 3. 官方接口首发

os.environ["ZHIHU_OPENAPI_APP_KEY"] = "functionhx"
os.environ["ZHIHU_OPENAPI_APP_SECRET"] = SECRET
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    make_site(root)
    point_at(root)

    Recorder.requests.clear()
    code, output = run(["publish", "demo", "--no-open"], ["", "", "", "不发了"])
    check(code == 1 and "已取消" in output, "anything but 发布 cancels")
    check(not Recorder.requests, "nothing is sent without confirmation")

    code, output = run(["publish", "demo", "--no-open"], ["2", "https://www.zhihu.com/topic/19555547/hot https://www.zhihu.com/topic/19550517", "6", "发布"])
    check(code == 0, f"publish succeeds: {output}")
    check(len(Recorder.requests) == 1, "exactly one request")
    request = Recorder.requests[0]
    check(request["method"] == "POST" and request["path"] == "/openapi/publish", "POST /openapi/publish")
    headers = request["raw_headers"]
    check(headers.get("X-App-Key") == "functionhx" and headers.get("X-Timestamp", "").isdigit() and headers.get("X-Log-Id"), "auth headers")
    check("X-Extra-Info" in headers and headers.get("X-Extra-Info") == "", "X-Extra-Info is sent, empty")
    message = f"app_key:functionhx|ts:{headers['X-Timestamp']}|logid:{headers['X-Log-Id']}|extra_info:"
    check(
        headers.get("X-Sign") == base64.b64encode(hmac.new(SECRET.encode(), message.encode(), hashlib.sha256).digest()).decode(),
        "the signature verifies",
    )
    sent = json.loads(request["body"])
    check(sent["type"] == "article" and sent["confirmed"] is True and sent["confirm_note"] == "confirmed by user after local preview", "official envelope")
    content = sent["content"]
    check(content["title"] == "测试文章：知乎同步" and content["html"].startswith("<h2>副标题</h2>"), "title and HTML")
    check(content["comment_permission"] == "nobody" and content["table_of_contents_enabled"] is False, "chosen comment permission, no TOC by default")
    check(content["creation_statement"] == "ai_creation", "chosen creation statement")
    check([t["topic_token"] for t in content["topics"]] == ["19555547", "19550517"], "topics from pasted links")
    check(SECRET not in request["body"], "the secret never goes in the body")
    record = json.loads((root / "_data" / "syndication.json").read_text(encoding="utf-8"))["/blog/2026/demo/"]["zhihu"]
    check(record["url"] == "https://zhuanlan.zhihu.com/p/998877" and record["id"] == "998877" and len(record["fingerprint"]) == 64, "the sync record")
    for path in [*(root / ".zhihu-out").rglob("*"), root / "_data" / "syndication.json"]:
        if path.is_file():
            check(SECRET not in path.read_text(encoding="utf-8") and headers["X-Sign"] not in path.read_text(encoding="utf-8"), f"no secret or signature in {path.name}")

    code, output = run(["publish", "demo", "--no-open"], [])
    check(code == 2, "a second publish is refused (use draft)")

    # 状态：一致
    code, output = run(["status"], [])
    check("已同步" in output, "status says synced")

# ---------------------------------------------------------------- 4. 发布失败不记账；每日上限

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    make_site(root)
    point_at(root)
    Recorder.reply = {"status": 1, "msg": "failed to publish: test", "data": None}
    code, _output = run(["publish", "demo", "--no-open", "--comment", "all", "--topics", "", "--statement", ""], ["发布"])
    check(code == 2, "status != 0 is a failure even with HTTP 200")
    check(json.loads((root / "_data" / "syndication.json").read_text(encoding="utf-8")) == {}, "a failed publish records nothing")
    Recorder.reply = {"status": 0, "msg": "success", "data": {"type": "article", "content_token": "1", "url": "https://zhuanlan.zhihu.com/p/1"}}
    today = zhihu.datetime.now(zhihu.CST).date().isoformat()
    (root / "publish-log.json").write_text(json.dumps([f"{today}T09:00:00+08:00"] * 50), encoding="utf-8")
    Recorder.requests.clear()
    code, _output = run(["publish", "demo", "--no-open", "--comment", "all", "--topics", "", "--statement", ""], ["发布"])
    check(code == 2 and not Recorder.requests, "the daily limit of 50 is enforced locally")

# ---------------------------------------------------------------- 5. Cookie 草稿兜底

os.environ["ZHIHU_COOKIE"] = COOKIE
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    make_site(root)
    point_at(root)
    code, _output = run(["draft", "demo", "--no-open"], [])
    check(code == 2, "draft needs a published article first")
    code, _output = run(["link", "demo", "https://zhuanlan.zhihu.com/p/123456"], [])
    check(code == 0, "link records a hand-published article")
    code, output = run(["draft", "demo", "--no-open"], [])
    check(code == 0 and "不需要更新" in output, "an unchanged article needs no draft")

    page = root / "_site" / "blog" / "2026" / "demo" / "index.html"
    page.write_text(PAGE.replace("普通段落", "改过的段落"), encoding="utf-8")
    Recorder.requests.clear()
    code, output = run(["draft", "demo", "--no-open"], ["不要"])
    check(code == 1 and not Recorder.requests, "anything but 草稿 cancels")
    code, output = run(["draft", "demo", "--no-open"], ["草稿"])
    check(code == 0, f"draft succeeds: {output}")
    check(len(Recorder.requests) == 1, "one request")
    request = Recorder.requests[0]
    check(request["method"] == "PATCH" and request["path"] == "/api/articles/123456/draft", "PATCH the draft of the existing article")
    check(request["raw_headers"].get("Cookie") == COOKIE and request["raw_headers"].get("x-xsrftoken") == "not-a-real-xsrf", "cookie and xsrf header")
    check("改过的段落" in json.loads(request["body"])["content"], "the new version is sent")
    check(all("/publish" not in item["path"] for item in Recorder.requests), "the web session never publishes")
    code, output = run(["status"], [])
    check("草稿已推送" in output, "status says a draft is waiting")
    code, output = run(["draft", "demo", "--no-open"], [])
    check(code == 0 and "已经存成草稿" in output, "the same version is not pushed twice")
    code, _output = run(["synced", "demo"], [])
    record = json.loads((root / "_data" / "syndication.json").read_text(encoding="utf-8"))["/blog/2026/demo/"]["zhihu"]
    check(code == 0 and "draft_fingerprint" not in record and record.get("updated_at"), "synced folds the draft into the record")
    code, output = run(["status"], [])
    check("已同步" in output, "and status is synced again")
    check(COOKIE not in (root / "_data" / "syndication.json").read_text(encoding="utf-8"), "the cookie is never written")

server.shutdown()
print("Zhihu CLI checks passed: conversion whitelist, maths, footnotes, sticky notes, signing, confirmed publish, failures, daily limit, and draft-only updates.")
