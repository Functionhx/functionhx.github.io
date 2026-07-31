---
layout: default
permalink: /blog/
title: 博客
lang: zh
translation_key: blog
nav: true
nav_order: 1
blog_name: al-folio
blog_description: 一个面向学术主页的简洁留白主题
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
