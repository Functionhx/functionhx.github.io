# frozen_string_literal: true

# 作者便利贴（站长决定 2026-10-07）。文章里这样写：
#
#   > [!便利贴] 写完半年后我改主意了……
#   > [!便利贴 粉] 颜色可选：黄（默认）、粉、绿、蓝
#
# 它紧跟在要批注的那一段后面。Markdown 转成 HTML 之后，这里把这种引用块换成
# <aside class="sticky-note">：没有脚本时它是段落之间的一张便利贴；有脚本时
# assets/js/sticky-notes.js 把它贴到正文右侧的留白里（宽屏）或折成段尾的折角（手机）。
# RSS 与搜索拿到的是同一段文字；Agent 叶子页在 headless_site.rb 里降级成普通引用。
module FunctionhxStickyNotes
  COLORS = { nil => "yellow", "黄" => "yellow", "粉" => "pink", "绿" => "mint", "蓝" => "blue" }.freeze
  PATTERN = %r{<blockquote>\s*<p>\[!便利贴(?:\s+([黄粉绿蓝]))?\]\s*(.*?)</blockquote>}m

  module_function

  def convert(html)
    return html unless html.include?("[!便利贴")

    html.gsub(PATTERN) do
      color = COLORS[Regexp.last_match(1)]
      body = "<p>#{Regexp.last_match(2).strip}"
      %(<aside class="sticky-note sticky-note--author" data-sticky-color="#{color}" role="note" aria-label="作者便利贴">) +
        %(<span class="sticky-note__by" aria-hidden="true">ƒ 作者</span>#{body}</aside>)
    end
  end
end

Jekyll::Hooks.register :documents, :post_convert do |document|
  next unless document.collection.label == "posts"

  document.content = FunctionhxStickyNotes.convert(document.content)
end
