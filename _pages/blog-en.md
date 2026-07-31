---
layout: default
permalink: /en/blog/
title: blog
lang: en
translation_key: blog
nav: true
nav_order: 1
blog_name: al-folio
blog_description: a simple whitespace theme for academics
display_tags: [formatting, images, links, math, code, blockquotes]
display_categories: [external-services]
pagination:
  enabled: true
  collection: posts
  locale: en
  permalink: /page/:num/
  per_page: 5
  sort_field: date
  sort_reverse: true
  trail:
    before: 1
    after: 3
---

{% include blog-index.liquid %}
