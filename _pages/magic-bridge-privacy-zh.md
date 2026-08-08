---
layout: page
title: Magic Bridge 隐私政策
permalink: /privacy/magic-bridge/
description: Magic Bridge 的本地数据处理、GitHub 登录与隐私说明。
lang: zh
translation_key: magic-bridge-privacy
nav: false
---

最后更新：2026 年 8 月 8 日

Magic Bridge 是连接 Apple 备忘录、Magic Notes 与本站的 macOS 工具。它遵循“笔记本地处理、身份最小授权”的原则。

## 本地笔记数据

- Apple 备忘录数据库仅在用户明确发起迁移后，以只读方式在 Mac 本机处理。
- 清单迁移包只用于将勾选状态交给 Magic Notes，权限为仅限当前用户读取，并在导入完成后删除。
- 笔记标题、正文、附件和清单内容不会发送到本站、Cloudflare、GitHub 或其他服务器。

## 网站连接数据

当用户主动选择“连接网站”时，Magic Bridge 通过系统浏览器和 GitHub OAuth 验证身份。为完成登录，服务会处理 GitHub 用户 ID、登录名以及 GitHub 提供的 OAuth 凭证。OAuth 凭证不会写入 App 包；Mac 端仅在系统钥匙串保存服务器密封后的会话。

PKCE 登录兑换码最多保留 5 分钟且使用后删除。密封会话最长有效 30 天，也可在 App 内随时断开并从钥匙串删除。相关网络请求由 Cloudflare Workers 承载，身份验证由 GitHub 提供。

## 数据用途与共享

上述身份数据只用于确认站长身份和建立个人网站连接。Magic Bridge 不投放广告、不进行跨站跟踪、不出售个人数据，也不会把笔记内容用于分析或训练。

## 控制与联系

用户可以在 Magic Bridge 中断开网站连接，并可在 GitHub 的已授权应用设置中撤销授权。如需咨询或删除相关连接信息，请联系 [functionhx@gmail.com](mailto:functionhx@gmail.com)。
