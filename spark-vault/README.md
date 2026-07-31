# Functionhx Spark Vault

Spark Vault is the owner-only service behind private Spark entries. The public
Jekyll site contains only the browser client. Private Chinese and English
content is encrypted before it is committed to the dedicated private
repository.

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
   - Callback: `https://YOUR_WORKER_HOST/auth/callback`
   - Request user authorization during installation.
   - Enable expiring user authorization tokens so the 30-day device session can
     refresh GitHub's short-lived user token without another login.
   - Repository permission: Contents read/write only.
   - Install it using “Only select repositories” for the private content
     repository and the public site repository.
3. Copy `wrangler.example.toml` to an untracked or deployment-managed
   `wrangler.toml` and replace the public configuration placeholders.
4. Store `GITHUB_CLIENT_SECRET`, `SESSION_KEY_B64`, and `MASTER_KEY_B64` as
   encrypted runtime secrets. Generate each encryption key from 32 bytes of
   cryptographically secure randomness. Keep one offline backup of the master
   key; losing it makes every private Spark unrecoverable.
5. Deploy, verify `/health`, then put the resulting endpoint in
   `_config.yml` under `spark_vault.endpoint` and rebuild the public site.

Never commit a GitHub client secret, session key, master key, OAuth token,
decrypted Spark, or real local deployment configuration.

## Local verification

Run from the repository root:

```bash
npm run test:spark-vault
```

The test uses fake repositories and fake credentials. It verifies OAuth owner
checks, origin checks, Chinese-only private drafts, ciphertext-only storage,
bilingual publication, unpublication, and optimistic conflict protection.
