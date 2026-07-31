---
layout: post
title: a post with image galleries
date: 2024-12-04 10:00:00 +0800
description: this is what included image galleries could look like
permalink: /en/blog/2024/photo-gallery/
lang: en
locale: en
translation_key: demo-post-photo-gallery
kind: demo
tags: [formatting, images]
categories: [sample-posts]
related_posts: false
---

The images in this post are arranged into a responsive mini-gallery.

<div class="row">
  <div class="col-sm mt-3 mt-md-0">
    {% include figure.liquid loading="eager" path="assets/img/1.jpg" title="example image" class="img-fluid rounded z-depth-1" %}
  </div>
  <div class="col-sm mt-3 mt-md-0">
    {% include figure.liquid loading="eager" path="assets/img/3.jpg" title="example image" class="img-fluid rounded z-depth-1" %}
  </div>
  <div class="col-sm mt-3 mt-md-0">
    {% include figure.liquid loading="eager" path="assets/img/5.jpg" title="example image" class="img-fluid rounded z-depth-1" %}
  </div>
</div>

<div class="caption">A responsive three-column image gallery.</div>
