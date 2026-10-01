# frozen_string_literal: true

# 外部样式表和 MathJax 不阻塞页面。
#
# 主题在 <head> 里写死了几个第三方样式表（Font Awesome、学术图标、Google Fonts，以及标题衬线体）。
# 它们都是普通的 <link rel="stylesheet">：浏览器必须等它们下载完才开始绘制，deferred 脚本和
# DOMContentLoaded 也跟着等。国内访问 Google Fonts 基本连不上，请求会一直挂到超时，页面就卡在加载页上。
#
# 这里在构建后改写 HTML：
# - 外部样式表改成 media="print" 先下载、加载完再切回 all 的异步写法，并保留 <noscript> 兜底；
#   切回 all 由 content_security_policy.rb 注入的事件代理按 data-async-style 完成，页面不带内联 onload；
# - Google Fonts 只在站长选了需要它的字体时才用得上（系统字体用不到），改成一个 <meta>，
#   由 site-preferences.js 按需插入。
module Functionhx
  module AsyncExternalStyles
    STYLESHEET = /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'](https?:\/\/[^"']+)["'])[^>]*>/i
    GOOGLE_FONTS = %r{\Ahttps://fonts\.googleapis\.com/}
    # MathJax 有一兆多，写成 defer 时会让后面所有 deferred 脚本（包括关掉加载页的那个）排队等它；
    # 改成 async：它下载完再渲染公式，页面本身不用等。MathJax 3 的配置在它之前的内联脚本里，异步加载没问题。
    MATHJAX_TAG = %r{<script\b[^>]*\bid=["']MathJax-script["'][^>]*>\s*</script>}i
    MATHJAX_SETUP = %r{<script\b[^>]*\bsrc=["'][^"']*mathjax-setup\.js[^"']*["'][^>]*>\s*</script>}i
    DEFERRED_MATHJAX = /<script\b(?=[^>]*\bsrc=["']https?:\/\/[^"']*mathjax[^"']*["'])(?=[^>]*\bdefer\b)(?![^>]*\basync\b)[^>]*>/i

    module_function

    def rewrite(html)
      return html unless html.include?("<head")

      head_end = html.index("</head>")
      return html unless head_end

      head = html[0...head_end].gsub(STYLESHEET) do |tag|
        href = Regexp.last_match(1)
        next tag if tag.include?("data-blocking")
        next %(<meta name="functionhx:google-fonts" content="#{href}">) if href.match?(GOOGLE_FONTS)

        async = tag.sub(/\s+defer\b/i, "").sub(/\s+media=["'][^"']*["']/i, "")
        async = async.sub(/\s*\/?>\z/, %( media="print" data-async-style>))
        "#{async}<noscript>#{tag.sub(/\s+defer\b/i, '')}</noscript>"
      end
      page = (head + html[head_end..]).gsub(DEFERRED_MATHJAX) { |tag| tag.sub(/\bdefer\b/, "async") }
      after_mathjax_setup(page)
    end

    # 异步的 MathJax 可能在缓存命中时抢先执行；把它挪到配置脚本（window.MathJax = {...}）后面，
    # 保证先有配置再加载，$…$ 行内公式才会被识别。
    def after_mathjax_setup(page)
      mathjax = page[MATHJAX_TAG]
      setup = page[MATHJAX_SETUP]
      return page unless mathjax && setup && page.index(mathjax) < page.index(setup)

      page.sub(mathjax, "").sub(setup) { |tag| "#{tag}\n#{mathjax}" }
    end
  end
end

Jekyll::Hooks.register [:pages, :documents], :post_render do |item|
  next unless item.output_ext == ".html" && item.output

  item.output = Functionhx::AsyncExternalStyles.rewrite(item.output)
end
