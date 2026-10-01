# frozen_string_literal: true

require "digest"
require "fileutils"

# 把 <head> 里相邻的本站样式表合成一个文件，减少阻塞首屏的请求数。
#
# 主题加本站一共十几个小样式表，每个都阻塞渲染；HTTP/2 下它们能并行，但慢网络上每个请求仍有
# 自己的往返和排队。这里在文件写盘后（读得到 Sass/Tailwind 的最终产物）按页合并：
# - 只合并「紧挨着」的一串 <link rel="stylesheet">：中间只允许空白、注释、<script>、<meta> 和
#   preconnect/preload 之类的 <link>（都不参与层叠）；遇到 <style>、<noscript> 或任何不能合并的
#   样式表就断开，所以层叠顺序和原来完全一样；
# - 带 id / media / data-* / integrity 的 link（主题按 id 切换代码高亮配色、异步加载的样式表）
#   以及外站样式表不动；含 @import 的文件不动；
# - 相对 url() 改写成以原文件为基准的绝对路径；
# - 合并结果按内容哈希命名放在 /assets/css/bundles/，带 ?v= 让 nginx 按一年 immutable 缓存。
#   新 link 带 data-bundled 列出原文件，check_built_site.py 据此确认每页仍加载了 function.css 等。
module Functionhx
  module CssBundles
    LINK = /<link\b[^>]*>/i
    # 允许夹在中间的：空白、注释、<script>、<meta>，以及不是样式表的 <link>（preconnect/preload 不参与层叠）。
    GAP = %r{\A(?:\s+|<!--.*?-->|<script\b[^>]*>.*?</script>|<meta\b[^>]*>|<link\b(?![^>]*\bstylesheet\b)[^>]*>)*\z}mi
    BUNDLE_DIR = "assets/css/bundles"

    module_function

    def process(html, dest, written)
      head_end = html.index("</head>")
      return html unless head_end

      head = html[0...head_end]
      runs = []
      current = []
      head.to_enum(:scan, LINK).each do
        match = Regexp.last_match
        tag = match[0]
        next unless tag.match?(/\bstylesheet\b/i)

        source = bundleable(tag, dest)
        if source && (current.empty? || head[current.last[:end]...match.begin(0)].match?(GAP))
          current << { tag: tag, start: match.begin(0), end: match.end(0), source: source }
          next
        end
        runs << current if current.size > 1
        current = source ? [{ tag: tag, start: match.begin(0), end: match.end(0), source: source }] : []
      end
      runs << current if current.size > 1
      return html if runs.empty?

      # 从后往前替换，前面的位置不受影响。第一个 link 的位置换成合并后的 link，其余删掉。
      runs.reverse_each do |run|
        href = write_bundle(run.map { |item| item[:source] }, dest, written)
        bundled = run.map { |item| item[:source][:path] }.join(" ")
        replacement = %(<link rel="stylesheet" href="#{href}" data-bundled="#{bundled}">)
        run.reverse_each.with_index do |item, index|
          last = index == run.size - 1
          head[item[:start]...item[:end]] = last ? replacement : ""
        end
      end
      head + html[head_end..]
    end

    def bundleable(tag, dest)
      return nil unless tag.match?(/\brel=["']?stylesheet\b/i)
      return nil if tag.match?(/\s(?:id|media|integrity|crossorigin|data-[\w-]+|disabled|title)\b/i)

      href = tag[/\bhref=["']([^"']+)["']/i, 1]
      return nil unless href&.start_with?("/") && !href.start_with?("//")

      path = href.sub(/[?#].*\z/, "")
      return nil unless path.end_with?(".css")

      file = File.join(dest, path)
      return nil unless File.file?(file)

      css = File.read(file, encoding: "UTF-8")
      return nil if css.match?(/@import\b/i)

      { path: path, css: css }
    end

    def write_bundle(sources, dest, written)
      body = sources.map do |source|
        base = File.dirname(source[:path])
        css = source[:css].sub(/\A﻿/, "").gsub(/@charset\s+["'][^"']*["']\s*;/i, "")
        css = absolutize_urls(css, base)
        "/* #{source[:path]} */\n#{css}\n"
      end.join
      digest = Digest::MD5.hexdigest(body)
      relative = "/#{BUNDLE_DIR}/#{digest}.css"
      unless written.include?(digest)
        FileUtils.mkdir_p(File.join(dest, BUNDLE_DIR))
        File.write(File.join(dest, relative), body)
        written << digest
      end
      "#{relative}?v=#{digest}"
    end

    def absolutize_urls(css, base)
      css.gsub(/url\(\s*(["']?)([^"')]+)\1\s*\)/i) do
        quote = Regexp.last_match(1)
        url = Regexp.last_match(2).strip
        if url.match?(%r{\A(?:[a-z][a-z0-9+.-]*:|/|#)}i)
          Regexp.last_match(0)
        else
          "url(#{quote}#{File.expand_path(url, base).sub(%r{\A[A-Za-z]:}, '')}#{quote})"
        end
      end
    end
  end
end

Jekyll::Hooks.register :site, :post_write do |site|
  written = Set.new
  (site.pages + site.documents).each do |item|
    next unless item.write? && item.output_ext == ".html"

    path = item.destination(site.dest)
    next unless File.file?(path)

    html = File.read(path, encoding: "UTF-8")
    updated = Functionhx::CssBundles.process(html, site.dest, written)
    File.write(path, updated) unless updated == html
  end
end
