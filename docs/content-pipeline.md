# Cross-platform content pipeline

## Principle

The website is the index and durable archive. An external platform remains the
canonical source until the owner provides an original Markdown file or a
platform export that may be republished locally.

Do not rely on fragile browser scraping for normal publishing. Zhihu,
Xiaohongshu, and WeChat Official Accounts do not provide one shared, stable
public feed format. Their profile URLs, exports, and terms also differ.

## External article record

Add an item to `external_articles` in `data/showcase/hub.yaml`:

```yaml
- id: stable-kebab-case-id
  date: 2026-07-30
  source: Zhihu
  url: https://example.com/canonical-article
  status: indexed
  language: zh-cn
  title:
    zh-cn: 中文原题
    en: Reviewed English title
  summary:
    zh-cn: 中文摘要
    en: Reviewed English summary
```

The public writing index should always show the original platform and canonical
URL. Use `status: indexed` for link-and-summary records and `status: mirrored`
only when a local, owner-supplied full-text copy exists.

## Local writing

For a locally hosted article:

1. Create the Chinese source under `content/zh/writing/<slug>.md`.
2. Create the reviewed English translation at the matching
   `content/en/writing/<slug>.md`.
3. Give both files the same `translationKey`.
4. Record the original platform URL in front matter when the article was first
   published elsewhere.

Notes and logs follow the same paired-path rule under `notes/` and `logs/`.

## Future automation

Automation should normalize an owner-provided export or a documented feed into
the record above, then open a reviewable change. It must never overwrite a
reviewed translation, guess missing authorship, or copy full text from an
external platform without an owner-supplied source.
