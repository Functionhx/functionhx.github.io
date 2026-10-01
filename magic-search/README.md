# Magic Search semantic retrieval

This service adds multilingual semantic ranking to the site's build-time public
search index. It does not call DeepSeek or another generative model and never
produces an answer. The browser merges its chunk rankings with local BM25
results, so search keeps working if this service is offline.

This is now a pure enhancement, not the baseline. The baseline is build-time
query expansion (see "Search expansions" below), which needs no server at all
and runs identically on GitHub Pages and the Tencent mirror. This service only
improves ranking further when it happens to be reachable (it is self-hosted on
the Tencent server and has no uptime guarantee).

## Search expansions (no server required)

`_data/search_expansions.yml` maps a chunk's `content_hash` to a short list of
alternate phrasings or related keywords a visitor might type instead of the
chunk's own wording (e.g. a chunk about "批量更新加速 Point-LIO" also indexed
under "LIO 性能优化"). `_plugins/magic_search_generator.rb` folds these into the
chunk's BM25 postings at build time — they never appear in the visible
title/excerpt, and nothing is fetched at query time. A chunk without an entry
still works; it just only matches its own wording.

Run `python3 scripts/list_search_expansion_gaps.py` after a build to see which
current chunks have no entry (and which entries are stale and can be deleted).
Filling gaps is a manual step — read the listed text and write a few phrases by
hand (normally via Claude Code while editing the content) — there is no script
that calls a model to generate them automatically, so this never depends on
network access or an API key during the build.

At startup and after each site deployment it reads
`/var/www/functionhx/current/assets/search/index-{zh,en}.json`. Vectors are
stored in SQLite by `content_hash`; only new or changed chunks are embedded.
Every query still needs one small query embedding, computed locally on the
Tencent server. No public/private Spark boundary is crossed: encrypted private
drafts never appear in these JSON indexes.

The public endpoints are:

- `GET /api/magic-search/health`
- `POST /api/magic-search/search` with `{"query":"...","language":"zh"}`

Nginx exposes the loopback-only Python process. Allowed browser origins and a
small per-IP rate limit are enforced by the service.

## Search visibility and private storage

The visitor index and no-JavaScript directory contain the homepage and published
records in navigation sections enabled by the owner. Chinese navigation settings
control both languages. Hidden sections, `search_exclude`, `visibility: unlisted`,
and theme demo records are omitted from the public search index. A published
record in a hidden section still has a public URL and public repository source;
navigation hiding is not confidentiality or an access restriction on that URL.

After GitHub verifies the site's owner credential, the browser may read additional
published Markdown sources from this public repository and build a separate
in-memory search supplement. These sources are never added to static search JSON
or browser storage. Closing search, locking the device, disconnecting the owner,
or leaving the page aborts pending reads and clears the supplement. Owner queries
use local matching and are not sent to the public semantic endpoint.

Encrypted private Sparks stay in Spark Vault and are not searched by this public
site feature. The build guard rejects records marked `private: true`,
`visibility: private/owner/draft`, or `draft: true` before public HTML is rendered.
It does not make anything committed to this public repository confidential.

Run `npm run test:search-access` to check visitor discovery, private build guards,
owner identity checks, source parsing, and logout cleanup.
