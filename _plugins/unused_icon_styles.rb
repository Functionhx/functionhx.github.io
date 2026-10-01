# frozen_string_literal: true

# 主题的 {% al_icons_styles %} 在每一页都插入 Academicons 和 Scholar Icons 两个阻塞渲染的样式表，
# 但站里几乎不用这两套图标。这一页的 HTML 里没有它们的类名时，就把对应的 <link> 去掉；
# 哪天在社交链接里加了 ORCID / Google Scholar 之类的图标，用到的页面会自动带上。
# （Font Awesome 不在此列：脚本会在运行时插入 fa- 图标，每页都需要它。）
module Functionhx
  module UnusedIconStyles
    LIBRARIES = {
      "academicons" => /class=["'][^"']*\bai-[a-z0-9]/i,
      "scholar-icons" => /class=["'][^"']*\bsi-[a-z0-9]/i,
    }.freeze

    module_function

    def rewrite(html)
      head_end = html.index("</head>")
      return html unless head_end

      body = html[head_end..]
      LIBRARIES.reduce(html) do |page, (library, usage)|
        next page if body.match?(usage)

        page.gsub(%r{(?:<!--[^>]*-->\s*)?<link\b[^>]*href=["'][^"']*/#{Regexp.escape(library)}-[^"']*["'][^>]*>\s*}i, "")
      end
    end
  end
end

Jekyll::Hooks.register [:pages, :documents], :post_render do |item|
  next unless item.output_ext == ".html" && item.output

  item.output = Functionhx::UnusedIconStyles.rewrite(item.output)
end
