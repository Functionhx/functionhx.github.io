---
layout: default
permalink: /blog/
title: 博客
lang: zh
translation_key: blog
nav: true
nav_order: 1
blog_name: 写作
blog_description: 记录机器人、具身智能、工程实践，以及那些值得认真想一想的问题。
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
