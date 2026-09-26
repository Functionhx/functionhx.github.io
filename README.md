# 樊宇琛 / Yuchen Fan

Research, projects, tools, writing, notes, and logs built on the MIT-licensed
[al-folio](https://github.com/alshedivat/al-folio) v1.1 starter. The site is
Chinese-only (owner decision 2026-09-24): there is no English edition and
`/en/` URLs return 404. Pages use the owner-approved `Function` identity and
`ƒ` mark.

The Chinese homepage opens with an illustrated portrait banner, links to four collections, and
shows recent updates in a vertical timeline. `_data/home.yml` owns its entry
labels and short update titles; dates and publication state come from the
existing collections. `_pages/about-zh.md` remains the editable introduction.
`assets/css/function.css`, `assets/css/function-home.css`, and `assets/js/function.js` apply the approved layout
and motion only to Chinese pages, preserving the existing theme, search, owner
controls, and contact interactions. Project details stay in their own sections.
The anime portrait was generated from the owner's portrait and is labeled as an
illustration. Responsive WebP versions live in `assets/img/function/`. The hero
has restrained scroll movement on desktop, a separate mobile crop, and a static
reduced-motion/no-JavaScript fallback.

## Local development

```bash
bundle install
npm ci
bundle exec jekyll serve
```

Open `http://localhost:4000/`.

## Content

- Add top-level pages under `_pages/`, projects and tools under `_projects/`,
  writing, notes, and logs under `_posts/`, courses under `_teachings/`, and
  books under `_books/`.
- Every record is Chinese: `lang: zh`, a `-zh.md` file name, and a
  `translation_key`. `validate_content.py` rejects `lang: en`.
- Keep external articles as canonical links until an owner-provided Markdown
  source or export is available.
- Upstream sample records may remain where owner content is not yet available.

## Online editing

The pencil icon turns the current public page into an inline Markdown editor
without navigating away from the site. Title, summary, publication state,
comments, front matter, and body can be edited alongside a live preview.
Drafts autosave only in that browser.

Spark uses a lighter direct-writing flow. Choose `New Spark` on the Spark index
and write in the page itself; there is no separate editor route or split
source/preview screen. Browser
autosaves are encrypted with a non-extractable device key. Saving a private
entry sends it through the companion Spark Vault service, which encrypts the
record before committing ciphertext to a dedicated private repository. Private
Markdown never enters this public repository or its Git history.

Both private saves and public synchronization require the Chinese title and
body.

The owner signs in once with the repository-scoped GitHub App. The browser keeps
only an opaque encrypted session, not a GitHub access token. Explicitly making a
Spark public creates or updates its `_posts` file in one atomic commit;
making it private removes that file in one recoverable commit. A Spark
published before the site became Chinese-only may still name an English file;
the next public commit deletes it if it still exists. Existing
public Spark entries can be reopened and adopted into the encrypted vault when
first saved. See [`spark-vault/README.md`](spark-vault/README.md) for the trust
boundary, one-time deployment, and key-backup requirements.

The gear icon opens the in-site section manager. Existing sections can be
shown or hidden. New sections can be created as a blank
page, article list, project-card grid, people-profile page, or repository list.
Desktop navigation spacing can be previewed and published as automatic,
compact, or relaxed; the selected layout is stored in `_data/site_ui.yml`. All
changed files are written in one atomic commit.

The general page and section editors still use a fine-grained GitHub token owned
by `Functionhx`, restricted to this repository, with `Contents: write` and
`Actions: read`. On a private computer, the owner may trust the device: the
token is encrypted with a non-extractable Web Crypto key and retained in
IndexedDB. Spark does not use that token flow; it uses the narrower GitHub App
and encrypted vault session described above. Neither credential is written to
the repository, analytics, or logs.

After a commit, the fixed publishing monitor follows the matching public GitHub
Actions run by commit SHA. It distinguishes queued, building/deploying, success,
and failure states, keeps an elapsed timer, and enables page refresh only after
the new version is live.

Keep a Spark private while it is still a draft. Public records always use
`published: true`; private records exist only as encrypted vault records.

Owner-authored posts may enable `giscus_comments: true`. Comments are stored in
this repository's GitHub Discussions through Giscus.

## Validation

```bash
python3 scripts/validate_content.py
bundle exec jekyll build
python3 scripts/check_built_site.py _site
```

The Kaggle Agent tool page reads
`https://functionhx.github.io/kaggle-agent/data/dashboard.json` every five
minutes and displays an unavailable state when that source is offline.

## Video

Set `video: true` in a page or post's front matter, then use the
shared include. The browser receives only the poster on first paint; the video
file is not requested until playback, which keeps ordinary page loads light.

```liquid
{%
  include video.liquid
  src='/assets/video/demo.mp4'
  webm_src='/assets/video/demo.webm'
  poster='/assets/img/video/demo-poster.webp'
  captions_zh='/assets/video/demo-zh.vtt'
  title='演示视频'
  caption='视频说明'
%}
```

Provide a caption track when speech is present. Large
videos should live in object storage or a video platform rather than the
GitHub Pages repository.
