# Functionhx Spark Vault

Spark Vault is the owner-only service behind private Spark entries. The public
Jekyll site contains only the browser client. Private content is encrypted in
the browser and then encrypted again by the service before it is committed to
the dedicated private repository. The service can
run either as a small Node 20 process on the owner's Tencent Cloud server or as
a Cloudflare Worker; the Node deployment is the production default.

## Security boundary

- GitHub App user authorization identifies the owner by the immutable numeric
  GitHub user id `172989722`.
- The GitHub App must be installed only on
  `Functionhx/functionhx-spark-private` and
  `Functionhx/functionhx.github.io`, with repository Contents read/write and no
  unrelated permissions.
- The browser creates a random vault root key. An independent passphrase and a
  WebAuthn PRF-capable passkey are combined to wrap it; neither factor is sent
  to the service. The non-secret keyring contains only salts, a credential id,
  and wrapped ciphertext.
- Every private Spark receives a separate random AES-256-GCM data key. The
  browser encrypts the complete bilingual value object and wraps that data key
  with the in-memory vault root key. The root key is never persisted in browser
  storage and disappears when the tab is reloaded or the vault is locked.
- `MASTER_KEY_B64` supplies a second, server-side AES-256-GCM envelope. It is
  defense in depth and supports migration from legacy version-1 records; it is
  not sufficient to decrypt new zero-knowledge private content.
- `SESSION_KEY_B64` seals the browser's opaque 30-day session. GitHub user
  access and refresh tokens remain encrypted inside that session and are never
  exposed to site JavaScript.
- The API accepts browser writes only from the exact allowlist
  `https://functionhx.github.io` and `https://fanyuchen.com.cn`. OAuth state
  seals the requesting site origin so the callback can return only to the
  approved tab that started the login.
- Publishing writes one atomic Git commit containing the Chinese and English
  Markdown files. Making an entry private removes both public files in one
  recoverable Git commit.
- A Chinese title and body are enough for both a private save and publication.
  When English is absent, publication creates the required English route as an
  explicit translation-pending mirror.
- The three-digit quick gate is a decoy, not an authentication factor. It is
  available only from the private-drafts browsing entry: entering its configured
  decoy value renders local fake notes and makes no keyring or notes API request.
  Saving or editing a real private Spark bypasses that gate and opens the strong
  unlock flow directly. The first GitHub authorization and strong unlock continue
  in one popup so browser popup blocking cannot interrupt the save. The real path
  still requires GitHub owner authorization, the independent passphrase, and the
  passkey. Because browser source is inspectable, the decoy must never be counted
  as security.

An authorized page can read plaintext while the vault is unlocked. A malicious
change to the public JavaScript could therefore steal data after unlock. Protect
the public repository and deployment accounts with hardware-backed two-factor
authentication, review every site deployment, and keep a strict Content
Security Policy. No design is "unhackable"; this design removes plaintext from
the server and repository while keeping a recoverable owner workflow.

## One-time setup

1. Create a private repository named `functionhx-spark-private`, initialize its
   `main` branch, and do not enable GitHub Pages.
2. Register a private GitHub App owned by `Functionhx`.
   - Homepage: `https://functionhx.github.io/`
   - Callback: `https://vault.fanyuchen.com.cn/auth/callback`
   - Leave “Request user authorization (OAuth) during installation” off. The
     Spark login button starts the state-protected OAuth flow after the app is
     installed.
   - Enable expiring user authorization tokens so the 30-day device session can
     refresh GitHub's short-lived user token without another login.
   - Repository permission: Contents read/write only.
   - Install it using “Only select repositories” for the private content
     repository and the public site repository.
3. Store `GITHUB_CLIENT_SECRET`, `SESSION_KEY_B64`, and `MASTER_KEY_B64` as
   encrypted runtime secrets. Generate each encryption key from 32 bytes of
   cryptographically secure randomness. Keep one offline backup of the master
   key while legacy records still exist.
4. On the first real unlock, choose a unique passphrase of at least 16
   characters and create the passkey. The browser downloads
   `magic-spark-vault-recovery.json`. Move it to encrypted offline storage and
   do not keep it in Downloads or a synced public folder. Anyone holding that
   file can recover the vault root key.
5. Deploy, verify `/health`, then put the resulting endpoint in
   `_config.yml` under `spark_vault.endpoint` and rebuild the public site.

Never reuse a GitHub SSH key as a Spark encryption key. Never commit a GitHub
client secret, session key, master key, recovery package, OAuth token, decrypted
Spark, or real local deployment configuration.

## Official Feishu Documents connection

The optional Documents integration uses Feishu's official user OAuth and
OpenAPI. It remains disabled until both `FEISHU_CLIENT_ID` and the encrypted
runtime secret `FEISHU_CLIENT_SECRET` are configured. The browser never reads a
Feishu cookie and never receives a Feishu access token; an already signed-in
Feishu browser session is reused only by the official authorization page.

1. Create an enterprise custom app at <https://open.feishu.cn/app> and limit
   its availability to the site owner.
2. Add this exact redirect URL in the app security settings:
   `https://functionhx-spark-vault.functionhx.workers.dev/auth/feishu/callback`.
   The backend always derives this as
   `${WORKER_ORIGIN}/auth/feishu/callback`; use
   `https://vault.fanyuchen.com.cn/auth/feishu/callback` instead only when the
   Tencent-hosted service is the configured public endpoint.
3. Enable only the user scopes `docx:document:create`,
   `drive:drive.metadata:readonly`, and `offline_access`. Enable refresh-token
   support in security settings if the console shows that switch, then publish
   the app so the permissions take effect.
4. Store `FEISHU_CLIENT_SECRET` only in the host's encrypted secret store. The
   App ID is placed in `FEISHU_CLIENT_ID`. Optionally set
   `ALLOWED_FEISHU_OPEN_ID` and `ALLOWED_FEISHU_TENANT_KEY`; otherwise the first
   successful owner connection is encrypted and pinned in the private content
   repository. `FEISHU_FOLDER_TOKEN` may select a destination folder; omitting
   it creates documents in the user's root space.

The authenticated site calls `POST /api/feishu/oauth/start`, opens the returned
official authorization URL, and receives a token-free completion message from
the callback. OAuth uses PKCE S256 plus an encrypted, five-minute, single-use
state record. Access and rotating refresh tokens are encrypted with
`MASTER_KEY_B64` before persistence. Refresh obtains a private-repository
compare-and-swap lease before using the single-use refresh token. Document
creation reserves an encrypted idempotency record before calling
`/open-apis/docx/v1/documents`; it then queries
`/open-apis/drive/v1/metas/batch_query` with `with_url: true` and returns the
official URL instead of constructing a tenant URL locally. Successful request
records also form the owner's private document index: authenticated
`GET /api/feishu/documents` decrypts and validates those records, returns at
most the 200 newest title/URL/timestamp summaries, and never exposes them in
the static site. Creation itself does not open a window. The owner explicitly
clicks a recorded link, which opens the official Feishu URL in a new browser
tab.

## Legacy migration

Version-1 records can still be opened with `MASTER_KEY_B64`. The browser wraps
them in the zero-knowledge inner envelope the next time they are saved as
private. Keep the old master key until every private record has been opened,
re-saved, reopened after a fresh unlock, and recovered once from the offline
package. Only then may the legacy decrypt path be retired.

## Tencent Cloud deployment

The production layout keeps the existing `fanyuchen.com.cn` Nginx site and its
`/wxcomapp/` proxy unchanged. Spark Vault listens only on
`127.0.0.1:8787`; a separate Nginx virtual host serves
`vault.fanyuchen.com.cn` over HTTPS.

1. Add an A record for `vault.fanyuchen.com.cn` pointing to `82.157.7.183`, and
   allow inbound TCP 443 in the Tencent Cloud security group.
2. Copy `worker.mjs`, `unlock-page.mjs`, and `server.mjs` to
   `/opt/functionhx-spark-vault`, create a locked system user named
   `spark-vault`, and install the example systemd unit.
3. Copy `deploy/functionhx-spark-vault.env.example` to
   `/etc/functionhx-spark-vault.env`, replace every placeholder on the server,
   and set the file mode to `0600` owned by root.
4. Install the separate Nginx virtual host, test Nginx, then issue and install a
   certificate for `vault.fanyuchen.com.cn` with Certbot.
5. Start the systemd service and verify both the loopback and public `/health`
   endpoints before configuring the Jekyll site.

The committed deployment files contain no secret values. The optional
`wrangler.example.toml` remains available for a Worker deployment, but it is
not needed on Tencent Cloud.

## Local verification

Run from the repository root:

```bash
npm run test:spark-vault
npm run test:spark-vault-server
npm run test:spark-vault-unlock
npm run test:feishu-worker
```

The tests use fake repositories and fake credentials. They verify OAuth owner
checks, origin checks, Chinese-only private drafts, ciphertext-only storage,
bilingual publication, unpublication, optimistic conflict protection, the
passphrase/passkey keyring, offline recovery wrapping, the single-popup OAuth to
strong-unlock continuation, acknowledged popup messaging, encrypted private-note
saving, and the no-network decoy path.
