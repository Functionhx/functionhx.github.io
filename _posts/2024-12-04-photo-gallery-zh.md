---
layout: post
title: 一篇带图片画廊的文章
slug: photo-gallery
date: 2024-12-04 10:00:00 +0800
published: true
description: 一篇包含图片画廊的文章
permalink: /blog/2024/photo-gallery/
lang: zh
locale: zh
translation_key: demo-post-photo-gallery
kind: demo
tags: [排版, 图片]
categories: [示例文章]
related_posts: false
---

本文中的图片排列为响应式迷你画廊。

<div class="row">
  <div class="col-sm mt-3 mt-md-0">
    {% include figure.liquid loading="eager" path="assets/img/1.jpg" title="示例图片" class="img-fluid rounded z-depth-1" %}
  </div>
  <div class="col-sm mt-3 mt-md-0">
    {% include figure.liquid loading="eager" path="assets/img/3.jpg" title="示例图片" class="img-fluid rounded z-depth-1" %}
  </div>
  <div class="col-sm mt-3 mt-md-0">
    {% include figure.liquid loading="eager" path="assets/img/5.jpg" title="示例图片" class="img-fluid rounded z-depth-1" %}
  </div>
</div>

<div class="caption">三栏响应式图片画廊。</div>
