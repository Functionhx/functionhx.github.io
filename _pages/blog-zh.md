---
layout: default
permalink: /blog/
title: 博客
lang: zh
translation_key: blog
nav: true
nav_order: 1
blog_name: 随笔与日志
blog_description: 以 al-folio 原版节奏承载写作、思考与工作记录
display_tags: [排版, 图片, 链接, 数学, 代码, 引用]
display_categories: [外部文章]
pagination:
  enabled: true
  collection: posts
  locale: zh
  permalink: /page/:num/
  per_page: 5
  sort_field: date
  sort_reverse: true
  trail:
    before: 1
    after: 3
---

{% include blog-index.liquid %}
