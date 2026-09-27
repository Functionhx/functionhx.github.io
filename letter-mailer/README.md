# Letter Mailer

首页「一封信」彩蛋的发信服务，跑在 Cloudflare Worker 上。

访客用暗号拿到上锁的信封后，可以填写自己的邮箱。本服务核对暗号，再用站长的
Gmail 把六位拆信密码发过去。它与 Spark Vault 分开部署：这里出问题碰不到那边保管的东西。

## 为什么放在 Cloudflare

腾讯云服务器在国内，连不稳 Gmail 的发信服务器；Worker 可以直连
`smtp.gmail.com:465`。

## 防滥用与隐私

- 只接受 `SITE_ORIGINS` 里的站点发来的请求。
- 暗号不对不发信；猜暗号本身也按 IP 限量。
- 同一个 IP 每天最多收 `PER_IP_DAILY_LIMIT` 封，全站每天最多 `DAILY_LIMIT` 封（KV 计数，近似上限）。
- 收件人只接受单个普通邮箱地址，拒绝换行等字符，防止邮件头注入；正文是固定模板。
- 不记录收件人地址。暗号、密码与 Gmail 凭据都只存在 Worker 密钥里。

六位密码只有一百万种组合，密文又是公开的，有心人可以离线把它试出来。
这是一个彩蛋的锁，不要把真正需要保密的内容写进信里。

## 一次性部署

1. Gmail 开启两步验证，在 <https://myaccount.google.com/apppasswords> 生成一个
   应用专用密码。
2. 复制配置并创建计数用的 KV：

   ```bash
   cd letter-mailer
   cp wrangler.example.toml wrangler.toml
   npx wrangler kv namespace create LETTER_LIMITS   # 把输出的 id 填进 wrangler.toml
   ```

   `wrangler.toml` 已在 `.gitignore` 中，不会被提交。

3. 设置四个密钥（每条命令会提示你粘贴值，值不会出现在命令行历史里）：

   ```bash
   npx wrangler secret put GMAIL_ADDRESS
   npx wrangler secret put GMAIL_APP_PASSWORD
   npx wrangler secret put LETTER_PHRASE
   npx wrangler secret put LETTER_PIN
   ```

4. 部署并检查：

   ```bash
   npx wrangler deploy
   curl https://functionhx-letter.<你的子域>.workers.dev/health
   ```

改暗号或密码时，站点设置里重新写一次信（重新加密），再用 `wrangler secret put`
更新对应的两个密钥，两边保持一致。

## 接口

`POST /send-pin`，JSON：`{ "phrase": "暗号", "email": "她的邮箱" }`

| 状态 | `error`                          | 含义                      |
| ---- | -------------------------------- | ------------------------- |
| 200  | —                                | 已发出                    |
| 400  | `invalid_email`                  | 邮箱格式不对              |
| 403  | `wrong_phrase` / `origin_denied` | 暗号不对 / 来源不在白名单 |
| 429  | `rate_limited`                   | 今天的次数用完了          |
| 502  | `send_failed`                    | Gmail 暂时发不出去        |
| 503  | `not_configured`                 | 密钥还没设置              |

本地测试：`npm run test:letter-mailer`（用假的 SMTP 服务器，不会真的发邮件）。
