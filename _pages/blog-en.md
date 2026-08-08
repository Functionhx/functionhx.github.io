---
layout: default
permalink: /en/blog/
title: blog
lang: en
translation_key: blog
nav: true
nav_order: 1
blog_kicker: MAGIC · BLOG
blog_name: Blog
blog_description: Technical breakdowns, engineering practice, and opinions without the detour.
blog_topics: Robotics · Engineering · Opinion
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
