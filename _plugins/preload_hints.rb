# frozen_string_literal: true

# 在 <head> 顶部为本页的同源样式表和脚本写 <link rel="preload">。
#
# 页面带 CSP <meta>（GitHub Pages 不能发响应头，只能这样）时，Chrome 的预加载扫描器不会提前下载
# 它后面的资源；解析器每被一个同步脚本或「等样式表的内联脚本」卡住一次，后面的资源就晚一个往返才
# 被发现。GitHub Pages 上一次往返约 250 ms，实测 DOMContentLoaded（加载遮罩消失）因此晚了约 1.5 s。
# 显式 preload 由解析器自己处理，不依赖扫描器，HTML 一到全部资源就并行开始下载。
#
# - 样式表：本页阻塞渲染的同源样式表（没有 media 或 media 为空），优先级照常；
# - 脚本：同源、没有 integrity/crossorigin 的外链脚本（preload 的请求模式必须和真正的请求一致才能复用），
#   带 fetchpriority="low"，不和样式表、首屏图片抢带宽；
# - 写在 CSP <meta> 及其事件代理脚本之后，所以预加载同样受 CSP 约束。
# 必须在 css_bundles.rb 之后运行（文件名按字母序加载，preload_hints 在 css_bundles 之后注册）。
module Functionhx
  module PreloadHints
    MARKER = "data-preload-hint"
    ANCHOR = %r{<script id="functionhx-csp-events">.*?</script>}m

    module_function

    def process(html)
      return html if html.include?(MARKER)

      head_end = html.index("</head>")
      anchor = html.match(ANCHOR)
      return html unless head_end && anchor

      hints = []
      html[0...head_end].scan(/<link\b[^>]*>/i) do |tag|
        next unless tag.match?(/\brel=["']?stylesheet\b/i)
        next if tag.match?(/\bmedia=["'](?!["'])/i) || tag.match?(/\s(?:integrity|crossorigin|disabled)\b/i)

        href = same_origin(tag[/\bhref=["']([^"']+)["']/i, 1])
        hints << %(<link rel="preload" href="#{href}" as="style" #{MARKER}>) if href
      end
      html.scan(/<script\b[^>]*>/i) do |tag|
        next if tag.match?(/\s(?:integrity|crossorigin|nomodule)\b|type=["']?module/i)

        href = same_origin(tag[/\bsrc=["']([^"']+)["']/i, 1])
        hints << %(<link rel="preload" href="#{href}" as="script" fetchpriority="low" #{MARKER}>) if href
      end
      return html if hints.empty?

      html.sub(ANCHOR) { |script| "#{script}#{hints.uniq.join}" }
    end

    def same_origin(href)
      return nil unless href&.start_with?("/") && !href.start_with?("//")

      href
    end
  end
end

Jekyll::Hooks.register :site, :post_write do |site|
  (site.pages + site.documents).each do |item|
    next unless item.write? && item.output_ext == ".html"

    path = item.destination(site.dest)
    next unless File.file?(path)

    html = File.read(path, encoding: "UTF-8")
    updated = Functionhx::PreloadHints.process(html)
    File.write(path, updated) unless updated == html
  end
end
