# frozen_string_literal: true

require "base64"
require "digest"

# 每页一份严格的 Content-Security-Policy（替换主题 head.liquid 里那条宽松的 <meta>）。
#
# 主题原来的 script-src 是 'self' 'unsafe-inline' https:，等于任何内联脚本、任何 https 脚本都能跑，
# 一处 HTML 注入就能拿到站长解锁后内存里的 GitHub 令牌。这里改成：
# - script-src 只放行本站、这一页真实引用的外部脚本（精确到文件），以及这一页每段内联脚本的 sha256；
# - 内联事件属性（onload/onerror/onclick）一律不允许：主题和本站模板里原有的几处都换成 data-* 属性，
#   由下面注入的一小段事件代理脚本处理；构建时若再出现 on*= 属性，直接报错，而不是悄悄放宽策略。
#
# 必须在文件写盘之后（jekyll-minifier 压缩之后）计算哈希，否则哈希和浏览器收到的字节对不上。
module Functionhx
  module ContentSecurityPolicy
    META = /<meta\s+http-equiv=(["']?)Content-Security-Policy\1\s+content=(["']).*?\2\s*\/?>/mi
    SCRIPT = %r{<script\b([^>]*)>(.*?)</script>}mi
    # 不执行的数据块不受 script-src 约束，也不需要哈希。
    DATA_TYPES = %w[application/json application/ld+json text/template text/x-template].freeze
    EVENTS_ID = "functionhx-csp-events"

    # 页面上用到 lazy-publication-badges.js 时，Altmetric / Dimensions 徽章脚本会再加载自家脚本（JSONP）。
    BADGE_SOURCES = %w[
      https://d1bxh8uas1mnw7.cloudfront.net https://embed.altmetric.com https://api.altmetric.com https://badge.dimensions.ai
    ].freeze

    # 主题生成的内联事件属性 → data-* 属性。只认这几种确切的写法，认不出的交给 assert_no_handlers 报错。
    HANDLER_REWRITES = [
      [/\sonerror="\s*this\.onerror\s*=\s*null;\s*document\.querySelectorAll\('\.responsive-img-srcset'\)\.forEach\(function\s*\(n\)\s*\{\s*n\.remove\(\);\s*\}\);\s*"/,
       " data-srcset-fallback"],
      [/\sonclick="\s*toggleCalendar\(\);?\s*"/, " data-toggle-calendar"],
    ].freeze
    # jekyll-minifier 会压缩这段属性里的空白（var element = this → var element=this），所以空白都按可选匹配。
    MORE_AUTHORS = /\sonclick="\s*var element\s*=\s*this;.*?element\.textContent\s*==\s*'(.*?)'\s*\?\s*'(.*?)'\s*:\s*'.*?';.*?\}\s*,\s*'(\d*)'\);\s*"/m

    EVENTS_SCRIPT = <<~JS.gsub(/\n\s*/, "")
      (() => {
        const d = document;
        const w = window;
        d.addEventListener("load", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.matches("link[data-async-style]")) target.media = "all";
          else if (target.matches("script[data-back-to-top]") && w.addBackToTop) w.addBackToTop();
        }, true);
        d.addEventListener("error", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.matches("[data-hide-repo-on-error]")) {
            const repo = target.closest(".repo");
            if (repo) repo.style.display = "none";
          } else if (target.matches("[data-srcset-fallback]")) {
            target.removeAttribute("data-srcset-fallback");
            d.querySelectorAll(".responsive-img-srcset").forEach((node) => node.remove());
          }
        }, true);
        d.addEventListener("click", (event) => {
          const target = event.target instanceof Element ? event.target.closest("[data-toggle-calendar],[data-more-authors-show]") : null;
          if (!target) return;
          if (target.hasAttribute("data-toggle-calendar")) {
            if (w.toggleCalendar) w.toggleCalendar();
            return;
          }
          const hide = target.dataset.moreAuthorsHide;
          const next = target.textContent === hide ? target.dataset.moreAuthorsShow : hide;
          if (!next) return;
          target.setAttribute("title", "");
          let position = 0;
          const timer = w.setInterval(() => {
            target.textContent = next.substring(0, position + 1);
            if (++position >= next.length) w.clearInterval(timer);
          }, Number(target.dataset.moreAuthorsDelay) || 10);
        });
      })();
    JS

    module_function

    def process(html, path, livereload: false)
      return html unless html.include?("<head")

      page = rewrite_handlers(html)
      assert_no_handlers(page, path)
      raise Jekyll::Errors::FatalException, "#{path}: theme Content-Security-Policy <meta> not found" unless page.match?(META)

      unless page.include?(%(id="#{EVENTS_ID}"))
        page = page.sub(META) { |meta| %(#{meta}<script id="#{EVENTS_ID}">#{EVENTS_SCRIPT}</script>) }
      end
      policy = policy_for(page, livereload)
      page.sub(META) { %(<meta http-equiv="Content-Security-Policy" content="#{policy}">) }
    end

    def rewrite_handlers(html)
      page = HANDLER_REWRITES.reduce(html) { |text, (pattern, replacement)| text.gsub(pattern, replacement) }
      page.gsub(MORE_AUTHORS) do
        hide, show, delay = Regexp.last_match.captures
        %( data-more-authors-hide="#{hide}" data-more-authors-show="#{show}" data-more-authors-delay="#{delay}")
      end
    end

    def assert_no_handlers(page, path)
      markup = page.gsub(SCRIPT, "").gsub(%r{<style\b[^>]*>.*?</style>}mi, "")
      handler = markup[/<[a-zA-Z][^<>]*?\s(on[a-z]+\s*=\s*["']?[^\s>]{0,60})/i, 1]
      return unless handler

      raise Jekyll::Errors::FatalException,
            "#{path}: inline event handler #{handler.inspect} is blocked by the site CSP; " \
            "use a data-* attribute handled in _plugins/content_security_policy.rb or a script file"
    end

    def policy_for(page, livereload)
      hashes = []
      external = []
      page.scan(SCRIPT) do |attributes, body|
        source = attributes[/\bsrc\s*=\s*["']([^"']+)["']/i, 1]
        if source
          external << external_source(source) if source.match?(%r{\A(?:https?:)?//}i)
          next
        end
        type = attributes[/\btype\s*=\s*["']([^"']+)["']/i, 1].to_s.downcase
        next if DATA_TYPES.include?(type)

        hashes << "'sha256-#{Base64.strict_encode64(Digest::SHA256.digest(body))}'"
      end
      external.concat(BADGE_SOURCES) if page.include?("/assets/js/lazy-publication-badges.js")
      external.concat(["http://localhost:35729", "ws://localhost:35729"]) if livereload

      script_src = ["'self'", *external.uniq, *hashes.uniq].join(" ")
      [
        "default-src 'self'",
        "script-src #{script_src}",
        "style-src 'self' 'unsafe-inline' https:",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        "media-src 'self' blob: https:",
        "frame-src 'self' https:",
        "connect-src 'self' https:#{' ws://localhost:35729' if livereload}",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    end

    # 外部脚本按文件放行；MathJax 运行时会从同一版本目录再加载组件，放行整个版本目录。
    def external_source(source)
      url = source.sub(%r{\A//}, "https://").sub(/[?#].*\z/, "")
      mathjax = url[%r{\Ahttps://cdn\.jsdelivr\.net/npm/mathjax@[^/]+/}]
      mathjax || url
    end
  end
end

Jekyll::Hooks.register :site, :post_write do |site|
  livereload = site.config["livereload"] ? true : false
  (site.pages + site.documents).each do |item|
    next unless item.write? && item.output_ext == ".html"

    path = item.destination(site.dest)
    next unless File.file?(path)

    html = File.read(path, encoding: "UTF-8")
    updated = Functionhx::ContentSecurityPolicy.process(html, item.relative_path, livereload: livereload)
    File.write(path, updated) unless updated == html
  end
end
