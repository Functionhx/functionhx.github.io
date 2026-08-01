# Magic Search semantic retrieval

This service adds multilingual semantic ranking to the site's build-time public
search index. It does not call DeepSeek or another generative model and never
produces an answer. The browser merges its chunk rankings with local BM25
results, so search keeps working if this service is offline.

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
