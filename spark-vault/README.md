# Functionhx Spark Vault

Spark Vault is the owner-only service behind private Spark entries. The public
Jekyll site contains only the browser client. Private content is encrypted
before it is committed to the dedicated private repository. The service can
run either as a small Node 20 process on the owner's Tencent Cloud server or as
a Cloudflare Worker; the Node deployment is the production default.

## Security boundary

- GitHub App user authorization identifies the owner by the immutable numeric
  GitHub user id `172989722`.
- The GitHub App must be installed only on
  `Functionhx/functionhx-spark-private` and
  `Functionhx/functionhx.github.io`, with repository Contents read/write and no
  unrelated permissions.
- `MASTER_KEY_B64` wraps a separate random AES-256-GCM key for every Spark
  record. Only ciphertext is written to the private repository.
- `SESSION_KEY_B64` seals the browser's opaque 30-day session. GitHub user
  access and refresh tokens remain encrypted inside that session and are never
  exposed to site JavaScript.
- The API accepts browser writes only from `https://functionhx.github.io`.
- Publishing writes one atomic Git commit containing the Chinese and English
  Markdown files. Making an entry private removes both public files in one
  recoverable Git commit.
- A Chinese title and body are enough for a private save. The service refuses
  publication until both Chinese and English titles and bodies are complete.

An authorized browser can read the plaintext it requested. Protect the public
site repository from unauthorized JavaScript changes and keep GitHub two-factor
authentication enabled.

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
   key; losing it makes every private Spark unrecoverable.
4. Deploy, verify `/health`, then put the resulting endpoint in
   `_config.yml` under `spark_vault.endpoint` and rebuild the public site.

Never commit a GitHub client secret, session key, master key, OAuth token,
decrypted Spark, or real local deployment configuration.

## Tencent Cloud deployment

The production layout keeps the existing `fanyuchen.com.cn` Nginx site and its
`/wxcomapp/` proxy unchanged. Spark Vault listens only on
`127.0.0.1:8787`; a separate Nginx virtual host serves
`vault.fanyuchen.com.cn` over HTTPS.

1. Add an A record for `vault.fanyuchen.com.cn` pointing to `82.157.7.183`, and
   allow inbound TCP 443 in the Tencent Cloud security group.
2. Copy `worker.mjs` and `server.mjs` to `/opt/functionhx-spark-vault`, create a
   locked system user named `spark-vault`, and install the example systemd unit.
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
```

The test uses fake repositories and fake credentials. It verifies OAuth owner
checks, origin checks, Chinese-only private drafts, ciphertext-only storage,
bilingual publication, unpublication, and optimistic conflict protection.
