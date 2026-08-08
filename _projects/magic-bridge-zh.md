---
layout: page
title: Magic Bridge
description: 让 Apple 备忘录、Magic Notes 与个人网站安全握手。
permalink: /tools/macapp/magic-bridge/
github: https://github.com/Functionhx/magic-bridge
lang: zh
translation_key: macapp-magic-bridge
kind: tool
importance: 11
category: macapp
img: assets/img/tools/macos/magic-bridge.webp
og_image: /assets/img/tools/macos/magic-bridge.webp
image_alt: Magic Bridge 网桥应用图标
image_width: 640
image_height: 640
app_visual: bridge
platform: macOS 14+
distribution_label: 开源 · 本地构建
product_note: 把读取 Apple 备忘录与连接个人网站这两件高权限操作，从笔记编辑器中独立出来。
---

{% include macapp-detail-hero.liquid %}

## 一座桥，两条路

Magic Bridge 不是另一款笔记应用，而是 Magic Notes 的原生权限边界。它只在你明确发起迁移或连接时工作，让高权限操作保持可见、可控和可审计。

- 从一致的只读快照恢复 Apple 备忘录中的原生清单状态；
- 使用权限为 `0600` 的一次性迁移包在本机交接，导入后自动删除；
- 通过系统 OAuth 窗口与 PKCE S256 连接个人网站；
- GitHub token 与 OAuth secret 始终留在服务端，Mac 端只保存密封会话。

## 获取方式

当前提供完整开源代码与 Xcode 工程。Release 构建已准备沙盒和隐私声明，但在 Apple Developer 签名与公证完成前，本站只提供可信的源码入口。
