# Migration notes

## 2026-07 personal hub rebuild

The temporary “six empty sections” scope has been retired. The site is again a
long-lived research, tools, writing, and activity hub.

Legacy Giscus comments, critiques, Sveltia CMS, `/fx/`, and decorative hidden
interactions remain disabled in `hugo.yaml`. They were removed during the
owner-requested minimal reset and are not silently recreated in this rebuild.
Their historical implementations remain available in Git history and can be
compatibility-restored one feature at a time.

Search is also disabled until the writing and notes collections contain enough
content to justify an index. Existing public section URLs are preserved.
