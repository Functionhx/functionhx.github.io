# Yuchen Fan — Research Portfolio

樊宇琛的中英双语研究主页、机器人工程作品集、技术笔记与开源贡献档案。网站使用 Hugo Extended + PaperMod，中文是内容源，英文位于 `/en/`。

## Local setup

依赖：Git、Python 3.11+、Hugo Extended 0.163.1。

```bash
git submodule update --init --recursive
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --requirement requirements.txt
```

本地预览和生产构建：

```bash
hugo server -D
python scripts/validate_content.py
python scripts/showcase/validate.py
python -m unittest discover -s tests -v
hugo --minify
```

## Add Chinese content

中文文件放在 `content/zh/`，英文保持相同相对路径和 `translationKey`。例如：

```bash
hugo new content content/zh/notes/my-note.md
hugo new content content/zh/projects/my-project.md
```

先完善中文 front matter、状态、贡献边界和证据；不要发布空章节或未经核验的指标。详见 [内容指南](docs/content-guide.md) 与 [i18n 说明](docs/i18n.md)。

## Translation

DeepSeek Key 只能通过环境变量提供：

```bash
export DEEPSEEK_API_KEY="..."
python scripts/translate.py --file content/zh/projects/batch-lio.md
python scripts/translate.py --changed
python scripts/validate_content.py
```

机器英文默认 `reviewed: false`；已审核或 `translation_locked: true` 的英文不会被覆盖。GitHub Action 只创建/更新 draft PR，不自动合并。配置方法见 [翻译说明](docs/translation.md)。

## Showcase fact source

先修改 `data/showcase/*.yaml`，再校验并重新生成：

```bash
python scripts/showcase/validate.py
python scripts/showcase/export_public_json.py
python scripts/showcase/render_github_profile.py
python scripts/showcase/render_resume_data.py
python scripts/showcase/render_portfolio_index.py
```

生成物位于 `static/showcase.json` 和 `generated/`；脚本不会修改其他仓库。详见 [showcase 同步](docs/showcase-sync.md)。

## Deployment

仓库现有 GitHub Pages workflow 会在 `main` 上校验并构建。Cloudflare Pages 使用 `main`、Hugo 0.163.1 和输出目录 `public`；账户内设置及当前双部署差异见 [部署文档](docs/deployment.md)。所需 GitHub Secret 只有翻译工作流使用的 `DEEPSEEK_API_KEY`。

## Common failures

- 页面无样式或模板：运行 `git submodule update --init --recursive`。
- 英文校验提示 stale hash：重新翻译对应中文文件，不要手改 hash。
- Action 无法创建 PR：确认 Actions 具有 `contents: write` 和 `pull-requests: write` 权限。
- Hugo 找不到页面：检查文件是否位于 `content/zh/` 或 `content/en/`，以及 `draft` 状态。
