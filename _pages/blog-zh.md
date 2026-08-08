---
layout: default
permalink: /blog/
title: 博客
lang: zh
translation_key: blog
nav: true
nav_order: 1
blog_kicker: MAGIC · BLOG
blog_name: 博客
blog_description: 技术拆解、工程实践，以及不绕弯子的观点。
blog_topics: 机器人 · 工程 · 观点
display_tags: []
display_categories: []
pagination:
  enabled: true
  collection: posts
  locale: zh
  permalink: /page/:num/
  per_page: 10
  sort_field: date
  sort_reverse: true
  trail:
    before: 1
    after: 3
---

{% include blog-index.liquid %}
