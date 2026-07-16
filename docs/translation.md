# DeepSeek Translation Workflow

## Local use

The translator uses DeepSeek's OpenAI-compatible Chat Completions endpoint. The default model is `deepseek-v4-pro`; override it with `DEEPSEEK_MODEL` when the official model lifecycle changes. The API key has no default and is read only from `DEEPSEEK_API_KEY`.

```bash
export DEEPSEEK_API_KEY="..."
python scripts/translate.py --file content/zh/projects/batch-lio.md
python scripts/translate.py --changed
python scripts/validate_content.py
```

Never put the key in a file, command example with a real value, browser JavaScript, or CI log. See the [DeepSeek API documentation](https://api-docs.deepseek.com/api/create-chat-completion) for the endpoint and current request format.

## Safety contract

`translation_prompt.md` prohibits new facts and requires Markdown/front-matter preservation. Before sending content, the script masks fenced code, inline code, URLs, formulas, HTML syntax, and other protected spans. It verifies every token and the front-matter structure before an atomic write.

`translation_memory.json` stores the source SHA-256, target, model, timestamp, and review state. An unchanged hash is skipped. API or validation failure leaves the existing English file intact. Files with `translation_locked: true` or `translation.reviewed: true` are never overwritten, including with `--force`.

`--bootstrap-existing` exists only for the initial migration of already paired drafts. Do not use it to declare a changed English file current; translate or review the source instead.

## GitHub Action

Add a repository Actions secret named `DEEPSEEK_API_KEY`. `.github/workflows/translate.yml` runs only for canonical Chinese pushes to `main` or manual dispatch. It translates, validates content and showcase data, builds Hugo, then uses `peter-evans/create-pull-request@v8` to create or update a **draft** PR. It never force-pushes or auto-merges.

Fork pull requests do not receive Actions secrets, and this workflow has no `pull_request_target` trigger. GitHub repository settings must allow Actions to create pull requests and grant the workflow `contents: write` plus `pull-requests: write`. Review every draft, resolve `<!-- REVIEW: ... -->`, and only then set `reviewed: true`.
