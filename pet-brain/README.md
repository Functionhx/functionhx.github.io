# Pet Brain

网站宠物 ƒ-01 的「大脑」：一个 Cloudflare Worker，替浏览器调用 DeepSeek。

浏览器里的宠物只在访客主动提问时才请求这里，感知、记忆和动作都在本地完成。本服务负责：

- **保管密钥**：DeepSeek API 密钥只存在 Worker 密钥里，不进仓库、不进浏览器；
- **有出处地回答**：每次先从站点的 `/llms-full.txt` 检索相关段落拼进提示词，回答附原文链接；
- **控制成本**：同一 IP 每小时 / 每天限量，全站每天有 token 预算（默认 1 亿），用完后宠物自动退回本地模式；
- **保护那封信**：问到信、暗号、密码时不调用模型，直接回固定的一句；
- **不留对话**：不记录、不存储任何对话内容，KV 里只有次数与 token 用量。

人设在 `persona.mjs`，编号规则是安全边界（`validate_content.py` 会检查它们还在）。

## 一次性部署

1. 在 <https://platform.deepseek.com/> 创建 API 密钥。
2. 复制配置并创建计数用的 KV：

   ```bash
   cd pet-brain
   cp wrangler.example.toml wrangler.toml
   npx wrangler kv namespace create PET_LIMITS   # 把输出的 id 填进 wrangler.toml
   ```

   `wrangler.toml` 已在 `.gitignore` 中，不会被提交。

3. 设置密钥（命令会提示你粘贴，值不会出现在命令行历史里；不要贴到任何聊天里）：

   ```bash
   npx wrangler secret put DEEPSEEK_API_KEY
   ```

4. 部署并检查：

   ```bash
   npx wrangler deploy
   curl https://functionhx-pet-brain.<你的子域>.workers.dev/health
   ```

5. 把 Worker 地址写进 `_config.yml` 的 `pet.endpoint`，发布网站。

## 接口

`POST /chat`，JSON：

```json
{
  "messages": [{ "role": "user", "content": "为什么批量更新会更快？" }],
  "page": { "url": "…", "title": "…", "section": "…", "excerpt": "…" },
  "petName": "访客给它起的小名（可选）"
}
```

返回 `text/event-stream`：若干 `{"t": "片段"}`，最后一条 `{"done": true, "sources": [{"title", "url"}]}`。
错误时返回 JSON `{"error": "budget_exhausted" | "rate_limited" | "origin_denied" | …}`。

## 合规提醒

在中国大陆向公众提供生成式 AI 对话，通常需要向属地网信办办理登记；AI 生成的回答需要显式标识
（网页上每条回答都带「AI 生成」）。上线前请自行确认。

测试：`npm run test:pet-brain`（模拟 DeepSeek 与 KV，不需要密钥）。
