# Academic Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bilingual single-page academic homepage for Yuchen Fan at
`functionhx.github.io/academic/` and `scholar.fanyuchen.com.cn`, cross-linked
with the existing technical blog.

**Architecture:** New repo `Functionhx/academic` (local: `~/Documents/academic`)
built from RayeRen/acad-homepage on plain Jekyll 4. One GitHub Actions workflow
builds twice (baseurl `/academic` for GitHub Pages, empty baseurl for the
Tencent mirror) and publishes each build. The blog repo (`~/Documents/blog`)
only gains a nav link, one sentence per language, and a small host-rewrite script.

**Tech Stack:** Jekyll 4.4, kramdown, Ruby (CI 3.3.5; local 4.0.6), Python 3
check script, GitHub Actions, nginx + certbot on Ubuntu (Tencent CVM).

**Spec:** `~/Documents/blog/docs/superpowers/specs/2026-09-24-academic-homepage-design.md`

## Global Constraints

- No invented publications, metrics, outcomes, affiliations, or contributions. Unknown items stay off the page; no placeholder links.
- The paper under anonymous review stays out of Publications; its title, venue and anonymised page are never written down until the decision.
- SinD 2.0 contribution text is exactly: data annotation and the 3DGS-based visual simulation extension (Sec. VI-G).
- Keep the acad-homepage MIT `LICENSE` and a footer credit to the template.
- English at `/`, Chinese at `/zh/`; every asset/link must work under baseurl `/academic` and under empty baseurl.
- Cross-links stay in the same host family and the same language.
- Blog edits limited to nav link + one sentence per language + host-rewrite script; blog JS stays dependency-free.
- Nothing is pushed to either repo's `main` without the owner's explicit go-ahead in chat (a push deploys publicly).
- Google Scholar and ORCID links are omitted until the owner supplies them.

## Review Focus

1. The `/zh/` page loaded directly (not via the language switch) must load CSS, JS, avatar, and teaser — relative asset paths break here first.
2. The github.io build served under `/academic/` must not reference `/assets/...` without the prefix; nav anchors must scroll within the page, not jump to the blog.
3. On the blog with JavaScript disabled, the Academic nav link must still work (points to `scholar.fanyuchen.com.cn`).
4. At phone width (375px) the sidebar must stack above content with no horizontal scroll, and the masthead nav must stay usable.
5. If the Tencent deploy job fails, GitHub Pages must still publish (`continue-on-error`), and a broken rsync must never switch `current`.

Each item is pinned by a check in `scripts/check_site.py` (Tasks 1–2), a
workflow property (Task 5), or an explicit manual check step (Tasks 4, 8, 9).

---

### Task 1: Scaffold the repo on Jekyll 4 with a failing site check

**Files:**

- Create: `~/Documents/academic/` (copy of RayeRen/acad-homepage without `.git`)
- Modify: `Gemfile`, `_config.yml`, `_includes/head.html`, `_includes/head/custom.html`, `_includes/scripts.html`, `_includes/masthead.html`, `_includes/author-profile.html`, `_layouts/default.html`
- Delete: `google_scholar_crawler/`, `.github/workflows/google_scholar_crawler.yaml`, `.github/FUNDING.yml`, `_includes/fetch_google_scholar_stats.html`, `run_server.sh`, `docs/`
- Create: `scripts/check_site.py`

**Interfaces:**

- Produces: `python3 scripts/check_site.py <site_dir> --baseurl <prefix>` exits 0 when clean, 1 with one line per problem. Later tasks extend its `REQUIRED_PAGES` and checks.

- [ ] **Step 1: Copy template and init repo**

```bash
cd ~/Documents
git clone -q --depth 1 git@github.com:RayeRen/acad-homepage.github.io.git academic
cd academic && rm -rf .git && git init -q -b main
rm -rf google_scholar_crawler .github/workflows/google_scholar_crawler.yaml .github/FUNDING.yml \
  _includes/fetch_google_scholar_stats.html run_server.sh docs
```

- [ ] **Step 2: Write the site check (the test)**

`scripts/check_site.py`:

```python
#!/usr/bin/env python3
"""Check a built academic site: pages, languages, local links, leftovers."""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

REQUIRED_PAGES = {"index.html": "en"}
FORBIDDEN_TEXT = ("Lorem ipsum", "RayeRen/acad-homepage.github.io/google-scholar-stats", "500x300.png")
SKIP_SCHEMES = {"http", "https", "mailto", "tel", "javascript", "data"}


class Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.refs: list[str] = []
        self.ids: set[str] = set()
        self.lang: str | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        if a.get("id"):
            self.ids.add(a["id"])
        for key in ("href", "src"):
            if a.get(key):
                self.refs.append(a[key])


def resolve(site: Path, baseurl: str, page: Path, ref: str) -> Path | None:
    parts = urlsplit(ref)
    if parts.scheme in SKIP_SCHEMES or (not parts.path and parts.fragment):
        return None
    path = unquote(parts.path)
    if path.startswith("/"):
        if baseurl and not (path == baseurl or path.startswith(baseurl + "/")):
            return site / "__outside_baseurl__" / path.lstrip("/")
        path = path[len(baseurl):] if baseurl else path
        target = site / path.lstrip("/")
    else:
        target = page.parent / path
    if target.is_dir() or path.endswith("/"):
        target = target / "index.html"
    return target


def check(site: Path, baseurl: str) -> list[str]:
    problems: list[str] = []
    for rel, lang in REQUIRED_PAGES.items():
        if not (site / rel).is_file():
            problems.append(f"missing page: {rel}")
    for page in sorted(site.rglob("*.html")):
        text = page.read_text(encoding="utf-8")
        rel = page.relative_to(site).as_posix()
        for bad in FORBIDDEN_TEXT:
            if bad in text:
                problems.append(f"{rel}: leftover template text {bad!r}")
        c = Collector()
        c.feed(text)
        if rel in REQUIRED_PAGES and c.lang != REQUIRED_PAGES[rel]:
            problems.append(f"{rel}: html lang={c.lang!r}, expected {REQUIRED_PAGES[rel]!r}")
        for ref in c.refs:
            parts = urlsplit(ref)
            if not parts.scheme and not parts.path and parts.fragment and parts.fragment not in c.ids:
                problems.append(f"{rel}: anchor #{parts.fragment} has no target")
            target = resolve(site, baseurl, page, ref)
            if target is not None and not target.exists():
                problems.append(f"{rel}: broken local ref {ref}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("site", type=Path)
    ap.add_argument("--baseurl", default="")
    args = ap.parse_args()
    problems = check(args.site, args.baseurl.rstrip("/"))
    for p in problems:
        print(p)
    print(f"{'FAIL' if problems else 'OK'}: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Replace the Gemfile with plain Jekyll 4**

```ruby
source "https://rubygems.org"

gem "jekyll", "~> 4.4"
gem "kramdown-parser-gfm"
gem "csv"
gem "logger"
gem "base64"
gem "bigdecimal"

group :jekyll_plugins do
  gem "jekyll-sitemap"
  gem "jekyll-redirect-from"
end
```

In `_config.yml`: set `plugins:` to `[jekyll-sitemap, jekyll-redirect-from]`,
delete `whitelist:`, `google_scholar_stats_use_cdn`, `repository`, and the
`compress_html` block; set `title: "Yuchen Fan"`, `url: "https://functionhx.github.io"`,
`baseurl: "/academic"`, add `exclude:` entries `scripts`, `README.md`,
`Gemfile.lock`. Remove `layout: compress` front matter from `_layouts/default.html`
(no compress layout ships with the template).

Run: `rm -f Gemfile.lock && bundle install`
Expected: `Bundle complete!`

- [ ] **Step 4: Build under /academic and watch the check fail**

Run: `bundle exec jekyll build -d _site && python3 scripts/check_site.py _site --baseurl /academic`
Expected: FAIL, including `leftover template text 'Lorem ipsum'`, `leftover template text '500x300.png'`, and `broken local ref /#-news` (root-absolute nav links fall outside `/academic`).

- [ ] **Step 5: Make every asset and nav path baseurl-safe**

Apply these exact replacements:

- `_includes/head.html`: `href="assets/css/main.css"` → `href="{{ '/assets/css/main.css' | relative_url }}"`; delete the stray inner `<head><base target="_blank"></head>` block.
- `_includes/head/custom.html`: every `href="images/...` → `href="{{ '/images/...' | relative_url }}"`; `assets/css/academicons.css` likewise; delete the two MathJax config scripts and the MathJax `<script src>`; delete the `msapplication-TileImage` and `msapplication-config` meta lines (those files do not exist).
- `_includes/scripts.html`: `src="assets/js/main.min.js"` → `src="{{ '/assets/js/main.min.js' | relative_url }}"`; delete the `fetch_google_scholar_stats` include line.
- `_includes/author-profile.html`: `src="{{ author.avatar }}"` → `src="{{ author.avatar | relative_url }}"`.
- `_includes/masthead.html`: `href="{{ domain }}{{ link.url }}"` → `href="{{ link.url }}"` (nav entries become pure `#anchor` fragments in Task 2).
- `_pages/about.md`: replace the whole body with `<span class='anchor' id='about-me'></span>` and one line: `I am Yuchen Fan, a Robotics Engineering undergraduate at Beijing Institute of Technology.` (verified on the GitHub profile).
- Delete `images/500x300.png`.

- [ ] **Step 6: Rebuild; check passes**

Run: `bundle exec jekyll build -d _site && python3 scripts/check_site.py _site --baseurl /academic`
Expected: `OK: 0 problem(s)`

Also run with empty baseurl: `bundle exec jekyll build -d _site_t --baseurl "" && python3 scripts/check_site.py _site_t`
Expected: `OK: 0 problem(s)`

- [ ] **Step 7: Commit**

```bash
printf '_site/\n_site_t/\n.jekyll-cache/\n.sass-cache/\n.DS_Store\n' >> .gitignore
git add -A && git commit -q -m "chore: scaffold academic homepage from acad-homepage on Jekyll 4

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Bilingual layout, per-language sidebar and nav, cross-link config

**Files:**

- Create: `_data/authors.yml`, `_data/i18n.yml`, `_config.tencent.yml`, `_pages/about-zh.md`
- Modify: `_config.yml`, `_data/navigation.yml`, `_layouts/default.html`, `_includes/masthead.html`, `_includes/author-profile.html`, `_pages/about.md`, `scripts/check_site.py`

**Interfaces:**

- Consumes: `scripts/check_site.py` from Task 1.
- Produces: page front matter keys `lang` (`en`|`zh`) and `author` (`en`|`zh`); `site.links.blog_en`, `site.links.blog_zh` (absolute URLs, set per host config); `site.data.i18n[lang]` strings `home`, `about`, `news`, `publications`, `research`, `tech_blog`, `switch_label`, `switch_url`.

- [ ] **Step 1: Extend the check (test first)**

In `scripts/check_site.py` set:

```python
REQUIRED_PAGES = {"index.html": "en", "zh/index.html": "zh"}
REQUIRED_ANCHORS = ("about-me", "news", "publications", "research")
```

and inside the per-page loop, after computing `c`:

```python
        if rel in REQUIRED_PAGES:
            for anchor in REQUIRED_ANCHORS:
                if anchor not in c.ids:
                    problems.append(f"{rel}: missing section anchor #{anchor}")
            if "tech-blog-link" not in c.ids:
                problems.append(f"{rel}: missing Tech Blog link")
```

Run: `bundle exec jekyll build -d _site && python3 scripts/check_site.py _site --baseurl /academic`
Expected: FAIL with `missing page: zh/index.html` and missing anchors.

- [ ] **Step 2: Config and data**

Append to `_config.yml`:

```yaml
links:
  blog_en: "https://functionhx.github.io/en/"
  blog_zh: "https://functionhx.github.io/"
```

`_config.tencent.yml`:

```yaml
url: "https://scholar.fanyuchen.com.cn"
baseurl: ""
links:
  blog_en: "https://fanyuchen.com.cn/en/"
  blog_zh: "https://fanyuchen.com.cn/"
```

`_data/authors.yml`:

```yaml
en:
  name: "Yuchen Fan"
  avatar: "/images/avatar.jpg"
  bio: "Undergraduate, Robotics Engineering<br>Beijing Institute of Technology"
  location: "Beijing, China"
  email: "functionhx@gmail.com"
  github: "Functionhx"
  linkedin: "zaizai-fan-152611414"
zh:
  name: "樊宇琛 Yuchen Fan"
  avatar: "/images/avatar.jpg"
  bio: "北京理工大学<br>机器人工程 本科生"
  location: "中国 北京"
  email: "functionhx@gmail.com"
  github: "Functionhx"
  linkedin: "zaizai-fan-152611414"
```

`_data/i18n.yml`:

```yaml
en:
  home: "Homepage"
  about: "About"
  news: "News"
  publications: "Publications"
  research: "Research"
  tech_blog: "Tech Blog →"
  switch_label: "中文"
  switch_url: "/zh/"
zh:
  home: "主页"
  about: "关于"
  news: "动态"
  publications: "论文"
  research: "研究"
  tech_blog: "技术博客 →"
  switch_label: "English"
  switch_url: "/"
```

Delete `_data/navigation.yml` (nav now comes from i18n).
Remove the `author:` block from `_config.yml` (authors.yml replaces it).

- [ ] **Step 3: Layout and includes**

`_layouts/default.html`: `<html lang="en" class="no-js">` → `<html lang="{{ page.lang | default: 'en' }}" class="no-js">`; after `{% include scripts.html %}` add
`<footer class="page__footer-credit"><small>Template: <a href="https://github.com/RayeRen/acad-homepage.github.io">acad-homepage</a> (MIT)</small></footer>`.

`_includes/masthead.html` — replace the `<ul class="visible-links">` contents:

```liquid
{% assign t = site.data.i18n[page.lang] %}
<li class="masthead__menu-item masthead__menu-item--lg masthead__menu-home-item">
  <a href="#about-me">{{ t.home }}</a>
</li>
<li class="masthead__menu-item">
  <a href="#news">{{ t.news }}</a>
</li>
<li class="masthead__menu-item">
  <a href="#publications">{{ t.publications }}</a>
</li>
<li class="masthead__menu-item">
  <a href="#research">{{ t.research }}</a>
</li>
<li class="masthead__menu-item">
  <a href="{% if page.lang == 'zh' %}{{ site.links.blog_zh }}{% else %}{{ site.links.blog_en }}{% endif %}">{{ t.tech_blog }}</a>
</li>
<li class="masthead__menu-item">
  <a href="{{ t.switch_url | relative_url }}" hreflang="{% if page.lang == 'zh' %}en{% else %}zh{% endif %}">{{ t.switch_label }}</a>
</li>
```

`_includes/author-profile.html` — first lines become
`{% assign author = site.data.authors[page.lang] | default: site.data.authors.en %}`
(drop the old `page.author` branch). Directly after the `author__content` div add:

```liquid
{% assign t = site.data.i18n[page.lang] %}
<p>
  <a
    id="tech-blog-link"
    class="btn btn--primary"
    href="{% if page.lang == 'zh' %}{{ site.links.blog_zh }}{% else %}{{ site.links.blog_en }}{% endif %}"
    target="_self"
  >
    {{- t.tech_blog -}}
  </a>
</p>
```

Remove `{% if site.description %}` block (it printed the site-wide description in the sidebar).

- [ ] **Step 4: Page stubs with explicit anchors**

`_pages/about.md` front matter: `permalink: /`, `lang: en`, `author_profile: true`, `title: ""`. Body:

```markdown
<span class='anchor' id='about-me'></span>

I am Yuchen Fan, a Robotics Engineering undergraduate at Beijing Institute of Technology.

<span class='anchor' id='news'></span>

# 🔥 News

<span class='anchor' id='publications'></span>

# 📝 Publications

<span class='anchor' id='research'></span>

# 🔬 Research
```

`_pages/about-zh.md`: same shape with `permalink: /zh/`, `lang: zh`, text
`我是樊宇琛，北京理工大学机器人工程专业本科生。`, headings `# 🔥 动态`, `# 📝 论文`, `# 🔬 研究`.

- [ ] **Step 5: Avatar**

```bash
magick ~/Documents/blog/assets/img/prof_pic-800.jpg -resize 400x400^ -gravity center -extent 400x400 -quality 85 images/avatar.jpg
```

- [ ] **Step 6: Both builds pass**

```bash
bundle exec jekyll build -d _site && python3 scripts/check_site.py _site --baseurl /academic
bundle exec jekyll build -d _site_t --config _config.yml,_config.tencent.yml && python3 scripts/check_site.py _site_t
grep -o 'href="https://fanyuchen.com.cn/[^"]*"' _site_t/zh/index.html | sort -u
grep -o 'href="https://functionhx.github.io/[^"]*"' _site/index.html | sort -u
```

Expected: both `OK: 0 problem(s)`; Tencent zh page links `https://fanyuchen.com.cn/`; github en page links `https://functionhx.github.io/en/`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -q -m "feat: bilingual layout, per-language sidebar, nav, and blog cross-links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: English content (About, News, Publications, Research)

**Files:**

- Modify: `_pages/about.md`
- Create: `images/sind2-teaser.jpg`

**Interfaces:**

- Consumes: anchors and layout from Task 2.
- Produces: the English content blocks that Task 4 translates one-to-one.

- [ ] **Step 1: Extract the SinD 2.0 teaser (Fig. 19)**

```bash
S=/private/tmp/claude-501/-Users-chen-Documents/5c867625-3e6c-4ef2-93a8-4891d73c4e81/scratchpad
[ -f $S/sind2.pdf ] || curl -sL https://arxiv.org/pdf/2607.16943v2 -o $S/sind2.pdf
pdftotext -layout $S/sind2.pdf - | awk '/\f/{p++} /Fig\. 19\./{print "page", p+1; exit}'
pdftoppm -r 200 -f <PAGE> -l <PAGE> -png $S/sind2.pdf $S/p
```

Open `$S/p-<PAGE>.png` with the Read tool, find the Fig. 19 bounding box in
pixels, then crop:

```bash
magick $S/p-<PAGE>.png -crop <W>x<H>+<X>+<Y> +repage -resize 1000x -quality 85 images/sind2-teaser.jpg
```

Read `images/sind2-teaser.jpg` to confirm it shows only the Fig. 19 pipeline (BEV map → 3DGS → DiFix3D → simulation), no caption text.

- [ ] **Step 2: Gather public facts for Research**

```bash
for r in Batch-LIO RoboAccel; do gh api repos/Functionhx/$r/readme -q .content | base64 -d | head -60; done
```

Confirm the Step 3 sentences still match the READMEs (they were drafted from
them on 2026-09-24; Batch-LIO is a reproduction built on Point-LIO and must stay
described that way). The owner's role and status wording are confirmed in Task 4 Step 4.

- [ ] **Step 3: Write the English body**

Replace the body of `_pages/about.md` (keep front matter):

```markdown
<span class='anchor' id='about-me'></span>

I am Yuchen Fan (樊宇琛), a Robotics Engineering undergraduate at [Beijing Institute of Technology](https://english.bit.edu.cn/). I work across algorithms, software, and hardware to turn robotics research into reliable systems, with an emphasis on real-robot deployment and reproducible results.

**Research interests:** embodied AI, autonomous systems, 3D scene intelligence (3D Gaussian Splatting, SLAM), and robot learning.

<span class='anchor' id='news'></span>

# 🔥 News

- _2026.07_: SinD 2.0, a multi-city UAV dataset for SOTIF-oriented safety validation at signalized intersections, is released on [arXiv](https://arxiv.org/abs/2607.16943).

<span class='anchor' id='publications'></span>

# 📝 Publications

<div class='paper-box'><div class='paper-box-image'><div><div class="badge">arXiv 2026</div><img src='{{ "/images/sind2-teaser.jpg" | relative_url }}' alt="SinD 2.0 3DGS-based visual simulation pipeline" width="100%"></div></div>
<div class='paper-box-text' markdown="1">

[SinD 2.0: A Multi-City UAV Dataset with Semantic Risk Annotations for SOTIF-Oriented Safety Validation at Signalized Intersections](https://arxiv.org/abs/2607.16943)

Yunwei Li, Shengjie Fu, Chunrong Chen, Chengxiang Zhao, **Yuchen Fan**, Mingyu Zhu, Yanchao Xu, Jiahui Xu, Anran Wang, Huanan Wang, Yuxin Zhang, Lan Yang, Chuzhao Li, Jie Ji, Yi He, Abhijit Sarkar, Akash Sonth, Hong Wang, Jun Li

_arXiv preprint_, 2026 · [**arXiv**](https://arxiv.org/abs/2607.16943) · [**PDF**](https://arxiv.org/pdf/2607.16943) · [**Dataset**](https://github.com/SOTIF-AVLab/SinD)

- My contribution: data annotation and the 3DGS-based visual simulation extension (Sec. VI-G).
</div>
</div>

<span class='anchor' id='research'></span>

# 🔬 Research

- **3DGS-based instance image goal navigation** (under review). Online 3D Gaussian Splatting mapping coupled with active exploration so a robot can find a specific object instance from a reference image.
- **[Batch-LIO](https://github.com/Functionhx/Batch-LIO)**. A batch-wise extension of Point-LIO that reproduces the batch-update idea of Point-LIWO: ~1 ms time-window grouping, in-batch motion de-skew, and batched EKF updates with OpenMP, kept A/B-comparable with Point-LIO. [Engineering details →]({{ site.links.blog_en }}projects/batch-lio/)
- **[RoboAccel](https://github.com/Functionhx/RoboAccel)**. An end-to-end stack that deploys a trained RL policy to a Zynq-7000 FPGA and an STM32H723 MCU with bit-exact fixed-point verification; for a wheel-legged robot balance controller, FPGA pure inference is 14.4× faster than the same policy on Cortex-M7.
- **3D Scene Intelligence**. 3D representations for navigation, visual localization, and editable scene generation. [Engineering details →]({{ site.links.blog_en }}research/3d-scene-intelligence/)
- **Formula Student Driverless**. Autonomous-system integration and track engineering. [Engineering details →]({{ site.links.blog_en }}projects/formula-student-driverless/)
```

- [ ] **Step 4: Build, check, and grep for leftovers**

```bash
bundle exec jekyll build -d _site && python3 scripts/check_site.py _site --baseurl /academic
grep -n 'TODO\|TBD\|Lorem' _pages/about.md; echo "leftover-grep exit=$?"
```

Expected: `OK: 0 problem(s)` and `leftover-grep exit=1` (no matches).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -q -m "feat: English academic content with SinD 2.0 and research overview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Chinese content, local preview, owner content review

**Files:**

- Modify: `_pages/about-zh.md`, possibly `_pages/about.md` (owner edits)

- [ ] **Step 1: Translate Task 3's body into `_pages/about-zh.md`**

Same structure and anchors; the paper title, authors, and venue stay in
English; prose is Chinese. Blog links use `{{ site.links.blog_zh }}` with the
zh permalinks: `projects/batch-lio/`, `research/3d-scene-intelligence/`,
`projects/formula-student-driverless/`. Contribution line:
`- 我的贡献：数据标注，以及基于 3DGS 的视觉仿真扩展（论文 VI-G 节）。`

- [ ] **Step 2: Build and check both configs**

```bash
bundle exec jekyll build -d _site && python3 scripts/check_site.py _site --baseurl /academic
bundle exec jekyll build -d _site_t --config _config.yml,_config.tencent.yml && python3 scripts/check_site.py _site_t
```

Expected: both `OK: 0 problem(s)`.

- [ ] **Step 3: Serve and visually check (Review Focus 1, 2, 4)**

Run in background: `bundle exec jekyll serve --port 4001 --baseurl /academic`
Open `http://localhost:4001/academic/` and `http://localhost:4001/academic/zh/`
directly. Check at desktop width and at 375px width: CSS loaded, avatar and
teaser visible, nav anchors scroll within the page, language switch works,
Tech Blog button target is correct, no horizontal scroll.

- [ ] **Step 4: Owner review gate**

Ask the owner to read both pages and confirm or edit: About wording, research
interests, which Research items stay, each item's description and the owner's
role, and the News list. Apply edits, rebuild, re-run the check. Do not
continue until the owner approves the content.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -q -m "feat: Chinese academic page and owner-approved content

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: CI workflow for GitHub Pages and the Tencent mirror

**Files:**

- Create: `.github/workflows/deploy.yml`, `.ruby-version`

**Interfaces:**

- Consumes: `_config.tencent.yml`, `scripts/check_site.py`.
- Produces: repo secrets it expects: `TENCENT_SSH_KEY`, `TENCENT_KNOWN_HOSTS` (created in Task 6).

- [ ] **Step 1: Write the workflow**

`.ruby-version`: `3.3.5`

`.github/workflows/deploy.yml`:

```yaml
name: Build and deploy academic homepage

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.3.5"
          bundler-cache: true
      - name: Build GitHub Pages site
        env:
          JEKYLL_ENV: production
        run: bundle exec jekyll build -d _site_github
      - name: Build Tencent mirror site
        env:
          JEKYLL_ENV: production
        run: bundle exec jekyll build -d _site_tencent --config _config.yml,_config.tencent.yml
      - name: Check both builds
        run: |
          python3 scripts/check_site.py _site_github --baseurl /academic
          python3 scripts/check_site.py _site_tencent
      - name: Add deployment health metadata
        run: |
          for d in _site_github _site_tencent; do
            printf '{"commit":"%s","built_at":"%s"}\n' "$GITHUB_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$d/healthz.json"
          done
      - uses: actions/upload-pages-artifact@v4
        with:
          path: _site_github
      - uses: actions/upload-artifact@v4
        with:
          name: site-tencent
          path: _site_tencent
          if-no-files-found: error
          retention-days: 1

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4

  deploy-tencent:
    name: Deploy Tencent Cloud mirror
    runs-on: ubuntu-latest
    needs: build
    continue-on-error: true
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: site-tencent
          path: _site
      - name: Configure deploy key
        env:
          TENCENT_SSH_KEY: ${{ secrets.TENCENT_SSH_KEY }}
          TENCENT_KNOWN_HOSTS: ${{ secrets.TENCENT_KNOWN_HOSTS }}
        run: |
          install -d -m 700 "$HOME/.ssh"
          printf '%s\n' "$TENCENT_SSH_KEY" > "$HOME/.ssh/deploy"
          printf '%s\n' "$TENCENT_KNOWN_HOSTS" > "$HOME/.ssh/known_hosts"
          chmod 600 "$HOME/.ssh/deploy" "$HOME/.ssh/known_hosts"
      - name: Publish mirror atomically
        env:
          DEPLOY_HOST: 82.157.7.183
          DEPLOY_USER: site-deploy
          DEPLOY_ROOT: /var/www/academic
        run: |
          release="$DEPLOY_ROOT/releases/$GITHUB_SHA"
          ssh -i "$HOME/.ssh/deploy" "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '$release'"
          rsync -rlptDz --checksum --delete --chmod=D755,F644 \
            -e "ssh -i $HOME/.ssh/deploy" _site/ "$DEPLOY_USER@$DEPLOY_HOST:$release/"
          ssh -i "$HOME/.ssh/deploy" "$DEPLOY_USER@$DEPLOY_HOST" \
            "test -s '$release/index.html' && test -s '$release/healthz.json' && \
             ln -sfn 'releases/$GITHUB_SHA' '$DEPLOY_ROOT/current.next' && \
             mv -Tf '$DEPLOY_ROOT/current.next' '$DEPLOY_ROOT/current'"
      - name: Verify mirror
        run: |
          actual="$(curl --fail -sS --retry 5 --retry-delay 2 https://scholar.fanyuchen.com.cn/healthz.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["commit"])')"
          test "$actual" = "$GITHUB_SHA"
```

The `concurrency.group` is `pages` per repo, so it does not interact with the blog repo's group.

- [ ] **Step 2: Validate the YAML locally**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/deploy.yml"); puts "yaml ok"'`
Expected: `yaml ok`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -q -m "ci: build twice and deploy to GitHub Pages and Tencent mirror

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Server, DNS, TLS, and deploy key

**Files (server `ubuntu@82.157.7.183`):**

- Create: `/var/www/academic/releases/` (owner `site-deploy`), `/etc/nginx/sites-available/academic`, symlink in `sites-enabled`
- Modify: `~site-deploy/.ssh/authorized_keys` (append one `restrict` key)

- [ ] **Step 1: New deploy key (local, never committed)**

```bash
S=/private/tmp/claude-501/-Users-chen-Documents/5c867625-3e6c-4ef2-93a8-4891d73c4e81/scratchpad
ssh-keygen -q -t ed25519 -N '' -C academic-deploy -f $S/academic_deploy
ssh ubuntu@82.157.7.183 "echo 'restrict $(cat $S/academic_deploy.pub)' | sudo tee -a ~site-deploy/.ssh/authorized_keys >/dev/null && sudo install -d -o site-deploy -g site-deploy -m 755 /var/www/academic /var/www/academic/releases"
ssh -i $S/academic_deploy -o IdentitiesOnly=yes site-deploy@82.157.7.183 'ls -ld /var/www/academic/releases'
```

Expected: the last command prints a `drwxr-xr-x ... site-deploy` line.

- [ ] **Step 2: Owner adds DNS**

Tell the owner, in plain steps: DNSPod console → `fanyuchen.com.cn` → 添加记录 →
主机记录 `scholar`, 记录类型 `A`, 记录值 `82.157.7.183`, TTL default → 保存.
Verify: `dig +short scholar.fanyuchen.com.cn @119.29.29.29` prints `82.157.7.183`.

- [ ] **Step 3: Certificate via the existing ACME webroot**

The port-80 default server already serves `/.well-known/acme-challenge/` from `/var/www/acme` for any host.

```bash
ssh ubuntu@82.157.7.183 'sudo certbot certonly --webroot -w /var/www/acme -d scholar.fanyuchen.com.cn --non-interactive --agree-tos -m functionhx@gmail.com'
```

Expected: `Successfully received certificate.`

- [ ] **Step 4: nginx site**

`/etc/nginx/sites-available/academic`:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name scholar.fanyuchen.com.cn;

    root /var/www/academic/current;
    index index.html;

    ssl_certificate /etc/letsencrypt/live/scholar.fanyuchen.com.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/scholar.fanyuchen.com.cn/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml text/xml application/xml;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location = /healthz.json {
        add_header Cache-Control "no-store" always;
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

HTTP → HTTPS for this host: add to the same file

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name scholar.fanyuchen.com.cn;
    location ^~ /.well-known/acme-challenge/ { root /var/www/acme; default_type text/plain; }
    location / { return 301 https://scholar.fanyuchen.com.cn$request_uri; }
}
```

```bash
ssh ubuntu@82.157.7.183 'sudo ln -sfn /etc/nginx/sites-available/academic /etc/nginx/sites-enabled/academic && sudo nginx -t && sudo systemctl reload nginx'
```

Expected: `syntax is ok`, `test is successful`. Blog still up:
`curl -sI https://fanyuchen.com.cn | head -1` → `HTTP/2 200`.

- [ ] **Step 5: Renewal dry run**

Run: `ssh ubuntu@82.157.7.183 'sudo certbot renew --dry-run --cert-name scholar.fanyuchen.com.cn'`
Expected: `Congratulations, all simulated renewals succeeded`.

---

### Task 7: Create the GitHub repo, secrets, Pages, first deploy

- [ ] **Step 1: Owner go-ahead**

Confirm in chat that the owner approves creating the public repo and pushing (this publishes the site).

- [ ] **Step 2: Repo, secrets, Pages source**

```bash
cd ~/Documents/academic
S=/private/tmp/claude-501/-Users-chen-Documents/5c867625-3e6c-4ef2-93a8-4891d73c4e81/scratchpad
gh repo create Functionhx/academic --public --description "Academic homepage of Yuchen Fan" --source . --remote origin
gh secret set TENCENT_SSH_KEY -R Functionhx/academic < $S/academic_deploy
ssh-keyscan -t ed25519 82.157.7.183 2>/dev/null | gh secret set TENCENT_KNOWN_HOSTS -R Functionhx/academic
gh api -X POST repos/Functionhx/academic/pages -f build_type=workflow
git push -u origin main
rm -f $S/academic_deploy
```

- [ ] **Step 3: Watch the run**

Run: `gh run watch -R Functionhx/academic --exit-status $(gh run list -R Functionhx/academic -L1 --json databaseId -q '.[0].databaseId')`
Expected: build, deploy, deploy-tencent all succeed.

- [ ] **Step 4: Verify both hosts serve the commit**

```bash
sha=$(git rev-parse HEAD)
for u in https://functionhx.github.io/academic https://scholar.fanyuchen.com.cn; do
  echo "$u $(curl -s $u/healthz.json)"; done | grep -c "$sha"
```

Expected: `2`.

---

### Task 8: Blog cross-links

**Files (in `~/Documents/blog`):**

- Create: `_data/academic.yml`, `_includes/academic-nav-link.liquid`, `assets/js/academic-link.js`
- Modify: `_includes/header.liquid` (after the pages loop, before the `{% if current_lang != 'en' %}` tools block), `_includes/scripts.liquid` (load the script), `_pages/about-zh.md`, `_pages/about-en.md`, `scripts/check_built_site.py`

**Interfaces:**

- Produces: every blog page has `<a id="academic-nav-link" data-academic-github="…">`.

- [ ] **Step 1: Failing check**

In `scripts/check_built_site.py`, add a function called from its main check
loop for the two homepages `index.html` and `en/index.html`:

```python
def check_academic_link(site: Path) -> list[str]:
    expected = {
        "index.html": ("https://scholar.fanyuchen.com.cn/zh/", "/academic/zh/"),
        "en/index.html": ("https://scholar.fanyuchen.com.cn/", "/academic/"),
    }
    problems = []
    for rel, (href, gh) in expected.items():
        text = (site / rel).read_text(encoding="utf-8")
        if f'id="academic-nav-link" href="{href}"' not in text:
            problems.append(f"{rel}: academic nav link missing or wrong (want {href})")
        if f'data-academic-github="{gh}"' not in text:
            problems.append(f"{rel}: academic github.io path missing (want {gh})")
    return problems
```

Wire it the same way the file's other checks append to its problem list.
Run: `bundle exec jekyll build && python3 scripts/check_built_site.py _site`
Expected: FAIL naming both pages.

- [ ] **Step 2: Implement**

`_data/academic.yml`:

```yaml
zh:
  label: 学术主页
  href: https://scholar.fanyuchen.com.cn/zh/
  github: /academic/zh/
en:
  label: Academic
  href: https://scholar.fanyuchen.com.cn/
  github: /academic/
```

`_includes/academic-nav-link.liquid`:

```liquid
{% assign academic = site.data.academic[current_lang] | default: site.data.academic.zh %}
<li class="nav-item">
  <a class="nav-link" id="academic-nav-link" href="{{ academic.href }}" data-academic-github="{{ academic.github }}">
    {{- academic.label -}}
  </a>
</li>
```

Insert `{% include academic-nav-link.liquid %}` in `_includes/header.liquid` right after the `{% endfor %}` that closes the pages loop.

`assets/js/academic-link.js`:

```js
(function () {
  if (location.hostname !== "functionhx.github.io") return;
  var link = document.getElementById("academic-nav-link");
  if (link && link.dataset.academicGithub) link.href = link.dataset.academicGithub;
})();
```

Load it from `_includes/scripts.liquid` with
`<script defer src="{{ '/assets/js/academic-link.js' | relative_url }}"></script>`.

One sentence per homepage, appended to the first paragraph block:

- `_pages/about-zh.md`: `学术方面的介绍和论文见[学术主页](https://scholar.fanyuchen.com.cn/zh/)。`
- `_pages/about-en.md`: `For research and publications, see my [academic homepage](https://scholar.fanyuchen.com.cn/).`

- [ ] **Step 3: Full blog validation**

```bash
cd ~/Documents/blog
python3 scripts/validate_content.py
bundle exec jekyll build
python3 scripts/check_built_site.py _site
npm run lint:prettier
npm run test:navigation
```

Expected: all pass. If `test:navigation` asserts an exact nav item list, add
the academic item to its expectation rather than weakening the test.

- [ ] **Step 4: Visual check (Review Focus 3)**

With the running blog preview at `http://localhost:4000/`, confirm the nav item
appears in zh and en, light and dark, desktop and mobile menus. Disable
JavaScript in the browser: the link still points to `scholar.fanyuchen.com.cn`.

- [ ] **Step 5: Commit, then push only after owner go-ahead**

```bash
git add -A && git commit -q -m "feat: link the academic homepage from the blog nav and homepages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Ask the owner before `git push` (the push also publishes the spec/plan docs commits already on local main).

---

### Task 9: End-to-end verification

- [ ] **Step 1: Hosts and TLS**

```bash
for u in https://functionhx.github.io/academic/ https://functionhx.github.io/academic/zh/ \
         https://scholar.fanyuchen.com.cn/ https://scholar.fanyuchen.com.cn/zh/ \
         http://scholar.fanyuchen.com.cn/; do
  printf '%s ' "$u"; curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$u"; done
```

Expected: four `200`, and the `http://` line `301 https://scholar.fanyuchen.com.cn/`.

- [ ] **Step 2: Four-direction cross-links**

```bash
curl -s https://scholar.fanyuchen.com.cn/zh/ | grep -o 'id="tech-blog-link" class="btn btn--primary" href="[^"]*"'
curl -s https://functionhx.github.io/academic/ | grep -o 'href="https://functionhx.github.io/en/"' | head -1
curl -s https://fanyuchen.com.cn/ | grep -o 'id="academic-nav-link" href="[^"]*"'
curl -s https://fanyuchen.com.cn/en/ | grep -o 'id="academic-nav-link" href="[^"]*"'
```

Expected: `fanyuchen.com.cn/`, `functionhx.github.io/en/`, `scholar.fanyuchen.com.cn/zh/`, `scholar.fanyuchen.com.cn/`.
Then in a browser on `https://functionhx.github.io/`, click the Academic link: lands on `/academic/zh/`.

- [ ] **Step 3: Owner acceptance**

Send the owner the four URLs and ask them to open `scholar.fanyuchen.com.cn` on a
phone with mobile data (no proxy) to confirm domestic access.

- [ ] **Step 4: Update memory**

Update `fanyuchen-personal-site` memory with: academic repo `Functionhx/academic`
at `~/Documents/academic`, hosts, `/var/www/academic`, separate deploy key.
