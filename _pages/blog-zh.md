---
layout: default
permalink: /blog/
title: 博客
lang: zh
translation_key: blog
nav: true
nav_order: 1
blog_kicker: FUNCTION · BLOG
blog_name: 博客
blog_description: 技术拆解、工程实践，以及不绕弯子的观点。
blog_topics: 机器人 · 工程 · 观点
display_tags: []
display_categories: []
# 博客、论文札记、见山共用 writing-feed.liquid；博客只列 kind: writing 的文章。
feed_kinds:
  - writing
---

{% include blog-index.liquid %}
