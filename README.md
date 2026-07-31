# 樊宇琛 / Yuchen Fan

Bilingual research, projects, tools, writing, notes, and logs built on the
MIT-licensed [al-folio](https://github.com/alshedivat/al-folio) v1.1 starter.
The `Magic ✨` browser label and `ƒ` favicon provide a compact identity without
replacing the author's bilingual name in the content.

## Local development

```bash
bundle install
npm ci
bundle exec jekyll serve
```

Open `http://localhost:4000/` for Chinese and
`http://localhost:4000/en/` for English.

## Content

- Add paired top-level pages under `_pages/`.
- Add paired projects and tools under `_projects/`.
- Add paired writing, notes, and logs under `_posts/`.
- Add paired courses under `_teachings/` and paired books under `_books/`.
- Give every pair the same `translation_key` and set `lang: zh` or `lang: en`.
- Keep external articles as canonical links until an owner-provided Markdown
  source or export is available.
- Keep the public presentation faithful to al-folio v1.1. Upstream sample
  records may remain where owner content is not yet available.

## Online editing

The pencil icon turns the current public page into an inline Markdown editor
without navigating away from the site. Title, summary, publication state,
comments, front matter, and body can be edited alongside a live preview.
Drafts autosave only in that browser.

Spark uses a lighter direct-writing flow. Choose `New Spark` on the Spark index
and write in the page itself; there is no separate editor route or split
source/preview screen. Chinese and English are written as one pair, autosaved
locally, and published to two independent `_posts` files in one atomic commit.
Each Spark item can also be reopened from the index and edited in place.

The gear icon opens the in-site section manager. Existing bilingual sections
can be shown or hidden together. New paired sections can be created as a blank
page, article list, project-card grid, people-profile page, or repository list.
Desktop navigation spacing can be previewed and published as automatic,
compact, or relaxed; the selected layout is stored in `_data/site_ui.yml`. All
changed files are written in one atomic commit.

Chinese is the authoring source of truth. The Spark writer and section manager
can generate an English draft through DeepSeek for review. Translation is open
to any visitor who supplies their own DeepSeek API Key, while publishing remains
restricted to the site owner. The DeepSeek key is used for that one request,
cleared immediately, never written to browser storage, and requested again for
the next translation.

Creating a commit requires a fine-grained GitHub token owned by `Functionhx`,
restricted to this repository, with `Contents: write` and `Actions: read`. On a
private computer, the owner may trust the device: the token is encrypted with a
non-extractable Web Crypto key and retained in IndexedDB so every editor can
reconnect after a reload. Without that option it stays in page memory only.
Disconnecting GitHub removes the encrypted credential; the token is never
written to the repository, analytics, or logs. The editor checks the account
and repository push permission before saving a credential.

After a commit, the fixed publishing monitor follows the matching public GitHub
Actions run by commit SHA. It distinguishes queued, building/deploying, success,
and failure states, keeps an elapsed timer, and enables page refresh only after
the new version is live.

Create Chinese and English records with the same `slug` and
`translation_key`. Their `lang`, `permalink`, and body content remain separate.
Set `published: false` while either language is still a draft, and turn it on
only after both records are ready.

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
