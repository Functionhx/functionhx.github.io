---
layout: default
permalink: /en/blog/
title: blog
lang: en
translation_key: blog
nav: true
nav_order: 1
blog_name: Writing
blog_description: Notes on robotics, embodied intelligence, engineering practice, and questions worth thinking through.
display_tags: []
display_categories: []
pagination:
  enabled: true
  collection: posts
  locale: en
  permalink: /page/:num/
  per_page: 10
  sort_field: date
  sort_reverse: true
  trail:
    before: 1
    after: 3
---

{% include blog-index.liquid %}
