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
