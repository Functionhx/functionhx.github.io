#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ƒ Function — 樊宇琛的终端主页。

    curl -sL functionhx.github.io/sh | sh                 （/sh 每次取最新的本文件并运行）
    curl -sL functionhx.github.io/sh | sh -s install      装成 functionhx 命令

只用 Python 标准库（curses），3.6 及以上可运行；不写任何文件、不联网，内容在构建时已嵌入本文件。
终端不支持交互（Windows、输出被重定向）时退回打印一张静态名片。

    python3 cli.py            交互界面
    python3 cli.py --card     打印彩色名片（/cli 就是它的输出）
    python3 cli.py --plain    打印无颜色名片

源文件在仓库的 terminal/cli.py，_plugins/headless_site.rb 构建时把内容数据写进 DATA。
"""

import json
import os
import re
import sys
import unicodedata

DATA = None  # @@HEADLESS_DATA@@

# ---------------------------------------------------------------- 宽度与折行

CLOSING = set("，。、；：！？）」』》〉】〕…—,.;:!?)]}%")


def char_width(ch):
    if unicodedata.combining(ch):
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def text_width(text):
    return sum(char_width(ch) for ch in text)


def clip(text, width):
    """截到显示宽度 width，超出时以 … 结尾。"""
    if text_width(text) <= width:
        return text
    out, used = [], 0
    for ch in text:
        w = char_width(ch)
        if used + w > width - 1:
            break
        out.append(ch)
        used += w
    return "".join(out) + "…"


def atoms(segments):
    """把带样式的片段切成不可再分的折行单位：英文单词（连同其后空格）、单个汉字；收尾标点粘在前一个单位上。"""
    result = []
    for text, style in segments:
        for match in re.finditer(r"[A-Za-z0-9_\-./:@#%&+=~'\"]+ ?|\s|.", text):
            piece = match.group(0)
            if result and piece[0] in CLOSING and result[-1][1] == style:
                result[-1] = (result[-1][0] + piece, style)
            else:
                result.append((piece, style))
    return result


def wrap(segments, width, indent=0, first_prefix=None):
    """按显示宽度折行，返回 [[(text, style), ...], ...]。"""
    width = max(width, 8)
    lines, line, used = [], [], 0
    prefix = first_prefix or []
    pad = [(" " * indent, "n")] if indent else []
    line, used = list(prefix), sum(text_width(t) for t, _ in prefix)
    for piece, style in atoms(segments):
        w = text_width(piece)
        if used + w > width and used > indent:
            lines.append(line)
            piece = piece.lstrip(" ")
            w = text_width(piece)
            line, used = list(pad), indent
            while w > width - indent:  # 超长单词硬切
                head = clip(piece, width - indent)[:-1]
                line.append((head, style))
                lines.append(line)
                piece = piece[len(head):]
                w = text_width(piece)
                line, used = list(pad), indent
        line.append((piece, style))
        used += w
    lines.append(line)
    return lines


# ---------------------------------------------------------------- Markdown → 带样式的行

INLINE = re.compile(r"(\*\*[^*]+\*\*)|(`[^`]+`)|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))")


def inline(text, base="n"):
    segments, pos = [], 0
    for match in INLINE.finditer(text):
        if match.start() > pos:
            segments.append((text[pos:match.start()], base))
        token = match.group(0)
        if match.group(1):
            segments.append((token[2:-2], "b"))
        elif match.group(2):
            segments.append((token[1:-1], "code"))
        elif match.group(3):
            alt = re.match(r"!\[([^\]]*)\]", token).group(1) or "图片"
            segments.append(("[图] " + alt, "dim"))
        else:
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", token).groups()
            segments.append((label, "acc"))
            if url != label and not url.startswith("#"):
                segments.append((" ‹" + url + "›", "dim"))
        pos = match.end()
    if pos < len(text):
        segments.append((text[pos:], base))
    return segments


def markdown(source, width):
    lines, paragraph, fence = [], [], None
    block = [None]  # 上一个块的类型；列表、引用之后接正文时补一个空行

    def gap(kind):
        if block[0] in ("list", "quote") and kind != block[0] and lines and lines[-1]:
            lines.append([])
        block[0] = kind

    def flush():
        if paragraph:
            joined = ""
            for part in paragraph:
                if joined and re.search(r"[A-Za-z0-9,.;:!?)]$", joined) and re.match(r"[A-Za-z0-9(]", part):
                    joined += " "
                joined += part
            lines.extend(wrap(inline(joined), width))
            lines.append([])
            del paragraph[:]

    for raw in source.splitlines():
        line = raw.rstrip()
        if fence is not None:
            if line.strip().startswith(fence):
                fence = None
                lines.append([])
            else:
                lines.append([("  " + clip(line, width - 2), "code")])
            continue
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            flush()
            fence = stripped[:3]
            continue
        if stripped == "$$":
            flush()
            fence = "$$"
            continue
        if not stripped:
            flush()
            continue
        heading = re.match(r"(#{1,6})\s+(.*)", stripped)
        if heading:
            flush()
            level = len(heading.group(1))
            style = "h1" if level == 1 else "h2" if level == 2 else "h3"
            marker = "▍" if level <= 2 else "·"
            lines.extend(wrap([(marker + " ", "acc")] + [(t, style) for t, _ in inline(heading.group(2))], width))
            lines.append([])
            continue
        bullet = re.match(r"(\s*)([-*+]|\d+[.)])\s+(.*)", line)
        if bullet:
            flush()
            depth = len(bullet.group(1)) // 2
            mark = "•" if not bullet.group(2)[0].isdigit() else bullet.group(2)
            indent = 2 + depth * 2 + text_width(mark) + 1
            prefix = [(" " * (2 + depth * 2), "n"), (mark + " ", "acc")]
            gap("list")
            lines.extend(wrap(inline(bullet.group(3)), width, indent=indent, first_prefix=prefix))
            continue
        if stripped.startswith(">"):
            flush()
            gap("quote")
            lines.extend(wrap(inline(stripped.lstrip("> "), "dim"), width, indent=2, first_prefix=[("│ ", "acc")]))
            continue
        if stripped.startswith("|"):
            flush()
            if not re.match(r"^\|[\s:\-|]+\|$", stripped):
                cells = [c.strip() for c in stripped.strip("|").split("|")]
                lines.append([(clip("  " + "  │  ".join(cells), width), "n")])
            continue
        gap("text")
        paragraph.append(stripped)
    flush()
    while lines and not lines[-1]:
        lines.pop()
    return lines


# ---------------------------------------------------------------- 样式

ANSI = {
    "n": "",
    "b": "1;97",
    "dim": "38;5;245",
    "acc": "38;5;141",
    "accb": "1;38;5;141",
    "acc2": "38;5;183",
    "cyan": "38;5;80",
    "code": "38;5;180",
    "h1": "1;38;5;183",
    "h2": "1;38;5;141",
    "h3": "1;97",
    "qr": "38;5;16;48;5;231",
}


def ansi_line(segments, color=True):
    merged = []
    for text, style in segments:  # 相邻同色片段合并，免得每个字都包一层颜色码
        if merged and merged[-1][1] == style:
            merged[-1] = (merged[-1][0] + text, style)
        else:
            merged.append((text, style))
    out = []
    for text, style in merged:
        code = ANSI.get(style, "") if color else ""
        out.append("\033[%sm%s\033[0m" % (code, text) if code else text)
    return "".join(out)


def qr_lines(rows, border=2):
    """两行码点合成一行字符：▀ 上黑下白，▄ 上白下黑，█ 全黑。前景黑、背景白写死，深色终端也能扫。"""
    size = len(rows) + 2 * border
    grid = [[False] * size for _ in range(size)]
    for y, row in enumerate(rows):
        for x, module in enumerate(row):
            grid[y + border][x + border] = module == "1"
    if size % 2:
        grid.append([False] * size)
    lines = []
    for y in range(0, len(grid), 2):
        chars = []
        for x in range(size):
            top, bottom = grid[y][x], grid[y + 1][x]
            chars.append("█" if top and bottom else "▀" if top else "▄" if bottom else " ")
        lines.append("".join(chars))
    return lines


# ---------------------------------------------------------------- 名片（/cli 与非交互环境）


def headline_lines(segments):
    """首页副标题：学校与身份一行，方向一行。"""
    if len(segments) <= 1:
        return list(segments)
    return [" · ".join(segments[:-1]), segments[-1]]


def column(items, key, cap):
    return min(cap, max([text_width(item[key]) for item in items] or [0]))


def rule(title, width):
    head = "── " + title + " "
    return [(head + "─" * max(4, width - text_width(head)), "acc")]


def card(color=True, width=78):
    p, site = DATA["profile"], DATA["site"]
    width = max(48, min(width, 100))
    inner = width - 2
    rows = []

    def add(segments=None):
        rows.append([("  ", "n")] + (segments or []))

    add()
    host = site.replace("https://", "")
    left = [("ƒ", "accb"), ("  " + p["brand"], "b")]
    gap = inner - text_width("ƒ  " + p["brand"]) - text_width(host)
    add(left + [(" " * max(2, gap), "n"), (host, "dim")])
    # 这一行刻意不着色：用 curl 抓取的 Agent 也能直接读懂。
    rows.append([("  Agent？请改用 " + site + "/llms.txt（不含颜色码）", "n")])
    add()
    add([(p["name"], "b"), ("  " + p["name_latin"], "dim")])
    for segment in headline_lines(p["segments"]):
        for line in wrap([(segment, "dim")], inner):
            add(line)
    add()
    add(rule("最新文章", inner))
    for item in DATA["writings"][:5]:
        add([(item["date"], "dim"), ("  ", "n"), (clip(item["title"], inner - 12), "b")])
    add()
    add(rule("项目与研究", inner))
    projects = DATA["projects"][:8]
    title_width = column(projects, "title", 24)
    for item in projects:
        title = clip(item["title"], title_width)
        pad = " " * (title_width - text_width(title) + 2)
        add([(item["kind_label"], "cyan"), ("  ", "n"), (title, "b"), (pad, "n"),
             (clip(item["description"], max(10, inner - 6 - title_width)), "dim")])
    add()
    add(rule("联系", inner))
    label_width = column(DATA["contacts"], "label", 14) + 2
    for contact in DATA["contacts"]:
        label = contact["label"] + " " * (label_width - text_width(contact["label"]))
        add([(label, "dim"), (contact["value"], "n")])
    if DATA.get("qr"):
        add()
        for line in qr_lines(DATA["qr"]):
            add([("  ", "n"), (line, "qr" if color else "n")])
    add()
    add(rule("更多", inner))
    add([("交互模式  ", "dim"), (DATA["launch"], "acc2")])
    add([("装成命令  ", "dim"), (DATA["launch"] + " -s install", "acc2"), ("  之后输入 functionhx", "dim")])
    add([(p["academic"]["label"] + "  ", "dim"), (p["academic"]["url"], "n")])
    add([("浏览器版  ", "dim"), (site + "/", "n")])
    add()
    return "\n".join(ansi_line(row, color) for row in rows) + ("\033[0m\n" if color else "\n")


# ---------------------------------------------------------------- 交互界面

COMMANDS = [
    ("/home", "首页", ["/首页", "/about"]),
    ("/posts", "文章列表", ["/文章", "/blog"]),
    ("/projects", "项目与研究", ["/项目"]),
    ("/tools", "工具", ["/工具"]),
    ("/news", "动态", ["/动态"]),
    ("/contact", "联系方式与微信二维码", ["/联系", "/qr", "/二维码"]),
    ("/search", "搜索全部内容，例如 /search lio", ["/搜索", "/s"]),
    ("/open", "打开当前列表第 N 项，例如 /open 2", ["/打开"]),
    ("/web", "显示当前内容的网页地址", ["/网页", "/url"]),
    ("/agent", "给 Agent 的机器入口", ["/机器"]),
    ("/help", "快捷键与命令", ["/帮助", "/?"]),
    ("/quit", "退出", ["/退出", "/exit", "/q"]),
]

TABS = [("home", "首页"), ("posts", "文章"), ("projects", "项目"), ("news", "动态"), ("contact", "联系")]


def resolve(name):
    name = name.lower()
    for command, _desc, aliases in COMMANDS:
        if name == command or name in aliases:
            return command
    return None


def search(query):
    words = [w for w in re.split(r"\s+", query.lower()) if w]
    results = []
    pools = [("文章", DATA["writings"]), ("项目", DATA["projects"]), ("动态", DATA["news"])]
    for label, pool in pools:
        for item in pool:
            hay = " ".join([item.get("title", ""), item.get("description", ""), " ".join(item.get("tags", [])),
                            " ".join(item.get("categories", [])), item.get("body", "")]).lower()
            if all(w in hay for w in words):
                score = sum(item.get("title", "").lower().count(w) * 5 + hay.count(w) for w in words)
                results.append((score, label, item))
    results.sort(key=lambda r: -r[0])
    return [(label, item) for _score, label, item in results]


class View(object):
    """一屏内容：行（带样式的片段）+ 可选的可选中条目。"""

    tab = None

    def __init__(self, title):
        self.title = title
        self.scroll = 0
        self.selected = 0
        self.items = []  # [(first_row, last_row, item)]

    def build(self, width):
        return []

    def url(self):
        return DATA["site"] + "/"


class TextView(View):
    def __init__(self, title, builder, tab=None, link=None):
        View.__init__(self, title)
        self.builder = builder
        self.tab = tab
        self.link = link

    def build(self, width):
        return self.builder(width)

    def url(self):
        return self.link or View.url(self)


class ListView(View):
    def __init__(self, title, entries, tab=None, intro=None, link=None):
        View.__init__(self, title)
        self.entries = entries  # [(meta, item)]
        self.tab = tab
        self.intro = intro
        self.link = link

    def build(self, width):
        lines, self.items = [], []
        if self.intro:
            lines.extend(wrap([(self.intro, "dim")], width))
            lines.append([])
        if not self.entries:
            lines.append([("没有找到内容。", "dim")])
        for index, (meta, item) in enumerate(self.entries):
            start = len(lines)
            number = "%d" % (index + 1)
            lines.append([(number + " " * (3 - len(number)), "dim"), (item["title"], "b")])
            if meta:
                lines.append([("   ", "n"), (meta, "cyan")])
            if item.get("description"):
                for line in wrap([(item["description"], "dim")], width - 3)[:2]:
                    lines.append([("   ", "n")] + line)
            self.items.append((start, len(lines) - 1, item))
            lines.append([])
        return lines

    def url(self):
        if self.items and 0 <= self.selected < len(self.items):
            return self.items[self.selected][2]["url"]
        return self.link or View.url(self)


def writing_meta(item):
    return " · ".join([item["date"]] + item.get("categories", []) + ["#" + t for t in item.get("tags", [])])


def project_meta(item):
    return item["kind_label"]


def reader(item, meta):
    def build(width):
        lines = wrap([(item["title"], "h1")], width)
        if meta:
            lines.append([(meta, "cyan")])
        lines.append([(item["url"], "dim")])
        lines.append([("─" * min(width, 60), "dim")])
        lines.append([])
        body = item.get("body") or item.get("description") or ""
        lines.extend(markdown(body, width))
        lines.append([])
        lines.append([("— 完 —  原文 ", "dim"), (item["url"], "acc")])
        return lines

    return TextView(item["title"], build, link=item["url"])


def home_view():
    p = DATA["profile"]
    view = TextView("首页", None, tab="home")

    def build(width):
        lines = [[]]
        lines.append([("ƒ ", "accb"), (p["name"], "h1"), ("  " + p["name_latin"], "dim")])
        for segment in headline_lines(p["segments"]):
            lines.extend(wrap([(segment, "n")], width))
        lines.append([])
        view.items = []
        lines.append(rule("最新文章", min(width, 72)))
        for item in DATA["writings"][:3]:
            start = len(lines)
            lines.append([(item["date"] + "  ", "dim"), (item["title"], "b")])
            if item.get("description"):
                lines.append([(" " * 12, "n"), (clip(item["description"], width - 12), "dim")])
            view.items.append((start, len(lines) - 1, ("posts", item)))
        lines.append([])
        lines.append(rule("项目与研究", min(width, 72)))
        projects = DATA["projects"][:5]
        title_width = column(projects, "title", 24)
        for item in projects:
            start = len(lines)
            title = clip(item["title"], title_width)
            pad = " " * (title_width - text_width(title) + 2)
            description = clip(item["description"], max(8, width - title_width - 8))
            lines.append([(item["kind_label"] + "  ", "cyan"), (title, "b"), (pad, "n"), (description, "dim")])
            view.items.append((start, start, ("projects", item)))
        lines.append([])
        lines.append([("↑↓ 选择 · Enter 打开 · 输入 ", "dim"), ("/", "acc"), (" 查看全部命令 · 数字键 1–5 切换标签", "dim")])
        return lines

    view.builder = build
    return view


def contact_view():
    def build(width):
        lines = [[]]
        label_width = column(DATA["contacts"], "label", 14) + 2
        for contact in DATA["contacts"]:
            label = contact["label"] + " " * (label_width - text_width(contact["label"]))
            lines.append([(label, "dim"), (contact["value"], "b")])
        if DATA.get("qr"):
            lines.append([])
            lines.append([("用手机微信扫一扫：", "dim")])
            lines.append([])
            for line in qr_lines(DATA["qr"]):
                lines.append([("  ", "n"), (line, "qr")])
        lines.append([])
        academic = DATA["profile"]["academic"]
        lines.append([(academic["label"] + "  ", "dim"), (academic["url"], "acc")])
        return lines

    return TextView("联系", build, tab="contact")


def help_view():
    def build(width):
        lines = [[("快捷键", "h2")], []]
        keys = [("↑ ↓ / j k", "移动选择或滚动"), ("Enter", "打开选中的条目"), ("← / Esc / q", "返回上一屏（首页按 q 退出）"),
                ("1–5", "切换顶部标签"), ("PgUp PgDn / 空格", "翻页"), ("g / G", "回到顶部 / 跳到底部"), ("/", "输入命令；Tab 补全")]
        for key, desc in keys:
            lines.append([("  " + key + " " * max(1, 20 - text_width(key)), "acc"), (desc, "n")])
        lines.extend([[], [("命令", "h2")], []])
        for command, desc, aliases in COMMANDS:
            alias = "  " + " ".join(aliases[:2]) if aliases else ""
            lines.append([("  " + command + " " * max(1, 12 - len(command)), "acc"), (desc, "n"), (alias, "dim")])
        lines.extend([[], [("输入不在列表里的词（例如 /lio）会直接按关键词搜索。", "dim")]])
        return lines

    return TextView("帮助", build)


def agent_view():
    site = DATA["site"]

    def build(width):
        lines = [[]]
        lines.extend(wrap([("这里是给人看的终端版。Agent 请读取不含颜色码的 Markdown / JSON：", "n")], width))
        lines.append([])
        for label, path in DATA["agent_entries"]:
            lines.append([("  " + label + " " * max(1, 14 - text_width(label)), "dim"), (site + path, "acc")])
        return lines

    return TextView("Agent 入口", build)


class App(object):
    def __init__(self, curses_module, screen):
        self.curses = curses_module
        self.screen = screen
        self.stack = [home_view()]
        self.input = None  # None = 浏览模式；字符串 = 正在输入命令
        self.palette_index = 0
        self.message = ""
        self.colors = {}
        self.setup_colors()

    # -- 颜色
    def setup_colors(self):
        c = self.curses
        self.colors = {"n": 0, "b": c.A_BOLD, "dim": c.A_DIM, "acc": c.A_BOLD, "accb": c.A_BOLD, "acc2": 0,
                       "cyan": 0, "code": 0, "h1": c.A_BOLD, "h2": c.A_BOLD, "h3": c.A_BOLD, "qr": c.A_REVERSE,
                       "sel": c.A_REVERSE, "bar": c.A_REVERSE, "tab": c.A_REVERSE}
        if not c.has_colors():
            return
        c.start_color()
        try:
            c.use_default_colors()
            bg = -1
        except c.error:
            bg = c.COLOR_BLACK
        rich = c.COLORS >= 256
        spec = {
            "dim": (245 if rich else c.COLOR_WHITE, bg, 0 if rich else c.A_DIM),
            "acc": (141 if rich else c.COLOR_MAGENTA, bg, 0),
            "accb": (141 if rich else c.COLOR_MAGENTA, bg, c.A_BOLD),
            "acc2": (183 if rich else c.COLOR_MAGENTA, bg, 0),
            "cyan": (80 if rich else c.COLOR_CYAN, bg, 0),
            "code": (180 if rich else c.COLOR_YELLOW, bg, 0),
            "h1": (183 if rich else c.COLOR_MAGENTA, bg, c.A_BOLD),
            "h2": (141 if rich else c.COLOR_MAGENTA, bg, c.A_BOLD),
            "qr": (16 if rich else c.COLOR_BLACK, 231 if rich else c.COLOR_WHITE, 0),
            "sel": (231 if rich else c.COLOR_WHITE, 237 if rich else c.COLOR_BLUE, 0),
            "bar": (231 if rich else c.COLOR_WHITE, 54 if rich else c.COLOR_MAGENTA, 0),
            "tab": (16 if rich else c.COLOR_BLACK, 183 if rich else c.COLOR_WHITE, c.A_BOLD),
        }
        for index, (name, (fg, background, extra)) in enumerate(sorted(spec.items()), start=1):
            try:
                c.init_pair(index, fg, background)
                self.colors[name] = c.color_pair(index) | extra
            except c.error:
                pass

    def attr(self, style, selected=False):
        value = self.colors.get(style, 0)
        if selected and style != "qr":
            value = (self.colors["sel"] | (value & self.curses.A_BOLD))
        return value

    # -- 绘制
    def put(self, y, x, text, attr=0, limit=None):
        height, width = self.screen.getmaxyx()
        if y < 0 or y >= height or x >= width:
            return x
        room = (limit if limit is not None else width) - x
        if room <= 0:
            return x
        if text_width(text) > room:
            text = clip(text, room)
        try:
            self.screen.addstr(y, x, text, attr)
        except self.curses.error:
            pass
        return x + text_width(text)

    def draw(self):
        screen = self.screen
        screen.erase()
        height, width = screen.getmaxyx()
        if height < 10 or width < 40:
            self.put(0, 0, "窗口太小，请放大到至少 40×10。q 退出")
            screen.refresh()
            return
        view = self.stack[-1]
        p = DATA["profile"]

        # 顶栏
        self.put(0, 0, " " * width, self.attr("bar"))
        x = self.put(0, 1, " ƒ " + p["brand"] + " ", self.attr("bar") | self.curses.A_BOLD)
        self.put(0, x, " " + p["name"] + " · " + p["name_latin"], self.attr("bar"))
        tabs_width = sum(text_width(" %d %s " % (i + 1, t)) + 1 for i, (_k, t) in enumerate(TABS))
        x = max(x + 2, width - tabs_width - 1)
        for index, (key, label) in enumerate(TABS):
            text = " %d %s " % (index + 1, label)
            x = self.put(0, x, text, self.attr("tab") if view.tab == key else self.attr("bar")) + 1

        # 标题行
        crumbs = " › ".join(v.title for v in self.stack)
        self.put(1, 2, crumbs, self.attr("dim"))

        # 内容区
        top, bottom = 3, height - 3
        area = bottom - top
        content_width = min(width - 4, 96)
        lines = view.build(content_width)
        selected_range = None
        if view.items:
            view.selected = max(0, min(view.selected, len(view.items) - 1))
            first, last, _item = view.items[view.selected]
            selected_range = (first, last)
            if first < view.scroll:
                view.scroll = max(0, first - 1)
            elif last >= view.scroll + area:
                view.scroll = last - area + 2
        view.scroll = max(0, min(view.scroll, max(0, len(lines) - area)))
        for row in range(area):
            index = view.scroll + row
            if index >= len(lines):
                break
            selected = selected_range is not None and selected_range[0] <= index <= selected_range[1]
            x = 2
            if selected:
                self.put(top + row, 0, "▌", self.attr("acc"))
            for text, style in lines[index]:
                x = self.put(top + row, x, text, self.attr(style, selected), limit=width - 1)
        if len(lines) > area:
            percent = int(100 * min(1.0, (view.scroll + area) / float(len(lines))))
            self.put(bottom, width - 8, "%3d%%" % percent, self.attr("dim"))

        # 命令面板（输入以 / 开头时）
        if self.input is not None:
            matches = self.palette()
            shown = matches[:8]
            for offset, (command, desc) in enumerate(reversed(shown)):
                y = height - 3 - offset
                index = len(shown) - 1 - offset
                active = index == self.palette_index
                self.put(y, 2, " " * min(width - 4, 60), self.attr("sel") if active else 0)
                x = self.put(y, 3, command, self.attr("acc", active))
                self.put(y, max(x + 2, 16), desc, self.attr("dim", active))

        # 底栏：提示 + 输入行
        hint = self.message or ("Enter 执行 · Tab 补全 · Esc 取消" if self.input is not None
                                else "↑↓ 选择  Enter 打开  ← 返回  / 命令  ? 帮助  q 退出")
        self.put(height - 2, 2, hint, self.attr("dim"))
        prompt = "› " + (self.input if self.input is not None else "")
        x = self.put(height - 1, 0, prompt, self.attr("acc"))
        if self.input is None:
            self.put(height - 1, x, "输入 / 打开命令面板", self.attr("dim"))
        try:
            self.curses.curs_set(1 if self.input is not None else 0)
            screen.move(height - 1, min(x, width - 1))
        except self.curses.error:
            pass
        screen.refresh()

    # -- 命令
    def palette(self):
        typed = (self.input or "").split(" ")[0].lower()
        matches = []
        for command, desc, aliases in COMMANDS:
            names = [command] + aliases
            if any(name.startswith(typed) for name in names):
                matches.append((command, desc))
        if typed not in ("", "/") and not matches:
            matches.append(("/search " + typed.lstrip("/"), "按关键词搜索"))
        return matches

    def run_command(self, text):
        text = text.strip()
        if not text.startswith("/"):
            text = "/search " + text
        name, _sep, arg = text.partition(" ")
        command = resolve(name)
        arg = arg.strip()
        if command is None:
            command, arg = "/search", (name.lstrip("/") + " " + arg).strip()
        if command == "/quit":
            return False
        if command == "/home":
            self.stack = [home_view()]
        elif command == "/posts":
            self.switch_tab("posts")
        elif command == "/projects":
            self.switch_tab("projects")
        elif command == "/tools":
            tools = [(project_meta(i), i) for i in DATA["projects"] if i["kind"] == "tool"]
            self.stack = [home_view(), ListView("工具", tools, tab="projects", link=DATA["site"] + "/tools/")]
        elif command == "/news":
            self.switch_tab("news")
        elif command == "/contact":
            self.switch_tab("contact")
        elif command == "/search":
            if not arg:
                self.message = "用法：/search 关键词"
                return True
            results = []
            for label, item in search(arg):
                detail = item.get("date") or item.get("kind_label", "")
                results.append((label if detail == label else "%s · %s" % (label, detail), item))
            self.stack.append(ListView("搜索：" + arg, results, intro="共 %d 条结果" % len(results)))
        elif command == "/open":
            view = self.stack[-1]
            try:
                view.selected = int(arg) - 1
                self.open_selected()
            except (ValueError, IndexError):
                self.message = "用法：/open 编号"
        elif command == "/web":
            self.message = "网页地址：" + self.stack[-1].url()
        elif command == "/agent":
            self.stack.append(agent_view())
        elif command == "/help":
            self.stack.append(help_view())
        return True

    def switch_tab(self, key):
        site = DATA["site"]
        if key == "home":
            self.stack = [home_view()]
            return
        if key == "posts":
            view = ListView("文章", [(writing_meta(i), i) for i in DATA["writings"]], tab="posts", link=site + "/blog/")
        elif key == "projects":
            view = ListView("项目与研究", [(project_meta(i), i) for i in DATA["projects"]], tab="projects",
                            link=site + "/projects/")
        elif key == "news":
            view = ListView("动态", [(i["date"], i) for i in DATA["news"]], tab="news", link=site + "/news/")
        else:
            view = contact_view()
        self.stack = [home_view(), view]

    def open_selected(self):
        view = self.stack[-1]
        if not view.items:
            return
        _first, _last, item = view.items[view.selected]
        if isinstance(item, tuple):  # 首页里的条目：(所属列表, 条目)
            kind, item = item
            meta = writing_meta(item) if kind == "posts" else project_meta(item)
        elif "kind_label" in item:
            meta = project_meta(item)
        elif "categories" in item:
            meta = writing_meta(item)
        else:
            meta = item.get("date", "")
        self.stack.append(reader(item, meta))

    # -- 按键
    def key(self, key):
        c = self.curses
        self.message = ""
        height, _width = self.screen.getmaxyx()
        page = max(1, height - 7)
        view = self.stack[-1]

        if self.input is not None:
            matches = self.palette()
            if key in ("\x1b",):
                self.input = None
            elif key in ("\n", "\r", c.KEY_ENTER):
                text = self.input
                if matches and self.palette_index < len(matches) and " " not in text.strip():
                    text = matches[self.palette_index][0]
                self.input = None
                return self.run_command(text)
            elif key in ("\t",):
                if matches:
                    self.input = matches[min(self.palette_index, len(matches) - 1)][0] + " "
                    self.palette_index = 0
            elif key in (c.KEY_UP,):
                self.palette_index = max(0, self.palette_index - 1)
            elif key in (c.KEY_DOWN,):
                self.palette_index = min(max(0, len(matches) - 1), self.palette_index + 1)
            elif key in (c.KEY_BACKSPACE, "\x7f", "\b", 127, 8):
                self.input = self.input[:-1]
                self.palette_index = 0
                if not self.input:
                    self.input = None
            elif isinstance(key, str) and key.isprintable():
                self.input += key
                self.palette_index = 0
            return True

        if key == "/":
            self.input = "/"
            self.palette_index = 0
        elif key in ("q", "Q", "\x1b", c.KEY_LEFT, "h", c.KEY_BACKSPACE, "\x7f"):
            if len(self.stack) > 1:
                self.stack.pop()
            elif key in ("q", "Q"):
                return False
        elif key in ("?",):
            self.stack.append(help_view())
        elif isinstance(key, str) and key in "12345":
            self.switch_tab(TABS[int(key) - 1][0])
        elif key in (c.KEY_UP, "k"):
            if view.items:
                view.selected = max(0, view.selected - 1)
            else:
                view.scroll = max(0, view.scroll - 1)
        elif key in (c.KEY_DOWN, "j"):
            if view.items:
                view.selected = min(len(view.items) - 1, view.selected + 1)
            else:
                view.scroll += 1
        elif key in (c.KEY_NPAGE, " "):
            view.scroll += page
            if view.items:
                view.selected = min(len(view.items) - 1, view.selected + 3)
        elif key in (c.KEY_PPAGE,):
            view.scroll = max(0, view.scroll - page)
            if view.items:
                view.selected = max(0, view.selected - 3)
        elif key in ("g", c.KEY_HOME):
            view.scroll, view.selected = 0, 0
        elif key in ("G", c.KEY_END):
            view.scroll = 10 ** 6
            if view.items:
                view.selected = len(view.items) - 1
        elif key in ("\n", "\r", c.KEY_ENTER, c.KEY_RIGHT, "l"):
            self.open_selected()
        elif key == c.KEY_RESIZE:
            pass
        return True

    def loop(self):
        while True:
            self.draw()
            try:
                key = self.screen.get_wch()
            except KeyboardInterrupt:
                return
            except self.curses.error:
                continue
            if not self.key(key):
                return


def interactive():
    try:
        import curses
    except ImportError:
        return False
    if not sys.stdout.isatty():
        return False
    if not sys.stdin.isatty():
        # curl … | python3 -：脚本从管道读入，键盘输入改从终端读。
        try:
            tty = os.open("/dev/tty", os.O_RDONLY)
            os.dup2(tty, 0)
            os.close(tty)
        except OSError:
            return False
    os.environ.setdefault("ESCDELAY", "25")
    import locale

    locale.setlocale(locale.LC_ALL, "")

    def main(screen):
        screen.keypad(True)
        App(curses, screen).loop()

    try:
        curses.wrapper(main)
    except KeyboardInterrupt:
        pass
    print("再见。浏览器版：" + DATA["site"] + "/")
    return True


def main(argv):
    if "--plain" in argv:
        sys.stdout.write(card(color=False))
        return 0
    if "--card" in argv:
        sys.stdout.write(card(color=not os.environ.get("NO_COLOR")))
        return 0
    if "--version" in argv:
        print(DATA.get("version", ""))
        return 0
    if not interactive():
        sys.stdout.write(card(color=sys.stdout.isatty() and not os.environ.get("NO_COLOR")))
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
