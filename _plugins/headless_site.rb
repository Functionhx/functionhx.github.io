# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"

# 无头主页：同一份站内内容，除了给浏览器的 HTML，再生成两套给「没有浏览器的访客」的版本。
#
# 1. 终端（给人看）
#    /sh      启动脚本（源码 terminal/sh）：每次取最新的 cli.py 并运行，也能装成 functionhx 命令：
#             curl -sL functionhx.github.io/sh | sh          curl -sL functionhx.github.io/sh | sh -s install
#    /cli.py  交互界面（Python 标准库 curses，源码 terminal/cli.py），内容在这里嵌入
#    /cli     彩色名片（ANSI），就是 `python3 cli.py --card` 的输出：curl https://functionhx.github.io/cli
#
# 2. Agent（给机器看，不含任何颜色码）
#    /llms.txt                  主干：简介 + 各分支地址 + 文章 / 项目清单
#    /agent/*.md                分支：身份、文章、项目、动态、联系、接口说明，每个都链回主干
#    <页面网址>index.html.md     叶子：每篇文章、项目、动态与栏目页的 Markdown 版（llms.txt 提案的约定）
#    /llms-full.txt             全文合集
#    /api/*.json                结构化数据
#
# 内容只从站内现有记录生成，不新增事实；主题自带的示例项目（translation_key 以 demo- 开头）、示例论文
# 等一律不收，任何记录都可以用 front matter `headless: false` 排除。身份与公开范围见 _data/headless.yml。
# 每个 HTML 页面开头加一行注释、<head> 里加 rel="alternate"，让 curl 的人和 Agent 都能发现这些入口。
module Functionhx
  module HeadlessSite
    KIND_LABELS = { "research" => "研究", "project" => "项目", "tool" => "工具" }.freeze
    KIND_ORDER = %w[research project tool].freeze

    def launch(base)
      "curl -sL #{base.sub(%r{\Ahttps?://}, '')}/sh | sh"
    end
    module_function :launch
    MARKER = "functionhx-headless"

    module_function

    # ------------------------------------------------------------ 内容模型

    def model(site)
      config = site.data["headless"] || {}
      base = site.config["url"].to_s.chomp("/")
      about = site.pages.find { |page| page.data["translation_key"] == "home" && page.data["home"] }
      headline = strip_html(about&.data&.dig("subtitle").to_s)
      contacts = Array(config["contacts"])

      {
        "site" => base,
        "version" => site.time.strftime("%Y-%m-%d"),
        "profile" => {
          "name" => config["name"],
          "name_latin" => config["name_latin"],
          "brand" => config["brand"],
          "headline" => headline,
          "segments" => headline.split(/\s*·\s*/).reject(&:empty?),
          "academic" => config["academic"],
          "mirror" => "https://fanyuchen.com.cn/",
        },
        "contacts_terminal" => contacts.select { |c| c["terminal"] },
        "contacts_agent" => contacts.select { |c| c["agent"] },
        "writings" => writings(site, base),
        "projects" => projects(site, base),
        "news" => news(site, base),
        "sections" => Array(config["sections"]),
        "mirror_negotiation" => config["mirror_negotiation"] == true,
      }
    end

    def included?(doc)
      doc.data["headless"] != false && doc.data["lang"].to_s != "en"
    end

    def writings(site, base)
      site.posts.docs.select { |doc| included?(doc) }.sort_by { |doc| -doc.date.to_i }.map do |doc|
        {
          "title" => doc.data["title"].to_s,
          "date" => doc.date.strftime("%Y-%m-%d"),
          "url" => base + doc.url,
          "md" => base + leaf(doc.url),
          "categories" => Array(doc.data["categories"]).map(&:to_s),
          "tags" => Array(doc.data["tags"]).map(&:to_s),
          "description" => doc.data["description"].to_s.strip,
          "body" => body(doc, base),
        }
      end
    end

    def projects(site, base)
      docs = site.collections["projects"]&.docs || []
      docs = docs.select { |doc| included?(doc) && !doc.data["translation_key"].to_s.start_with?("demo-") }
      docs.sort_by { |doc| [KIND_ORDER.index(doc.data["kind"].to_s) || 9, doc.data["importance"].to_i, doc.data["title"].to_s] }
          .map do |doc|
        kind = doc.data["kind"].to_s
        {
          "title" => doc.data["title"].to_s,
          "kind" => kind,
          "kind_label" => KIND_LABELS.fetch(kind, "项目"),
          "url" => base + doc.url,
          "md" => base + leaf(doc.url),
          "description" => doc.data["description"].to_s.strip,
          "body" => body(doc, base),
        }
      end
    end

    def news(site, base)
      docs = site.collections["news"]&.docs || []
      docs.select { |doc| included?(doc) }.sort_by { |doc| -doc.date.to_i }.map do |doc|
        {
          "title" => doc.data["title"].to_s,
          "date" => doc.date.strftime("%Y-%m-%d"),
          "url" => base + doc.url,
          "md" => base + leaf(doc.url),
          "body" => body(doc, base),
        }
      end
    end

    def leaf(url)
      url.end_with?("/") ? "#{url}index.html.md" : "#{url}.md"
    end

    # Markdown 源文件去掉 front matter、Liquid 标签和 kramdown 属性，站内相对链接改成绝对地址。
    def body(doc, base)
      source = File.read(doc.path, encoding: "UTF-8")
      source = source.sub(/\A---\s*\n.*?\n---\s*\n/m, "")
      source = source.gsub(/\{%-?\s*(?:end)?raw\s*-?%\}/, "")
      source = source.gsub(/\{%-?.*?-?%\}/m, "").gsub(/\{\{.*?\}\}/m, "")
      source = source.gsub(/^\s*\{:[^}]*\}\s*$\n?/, "").gsub(/\{:[^}]*\}/, "")
      source = source.gsub(/<img\b[^>]*>/i) do |tag|
        "![#{tag[/\balt=["']([^"']*)["']/i, 1]}](#{tag[/\bsrc=["']([^"']+)["']/i, 1]})"
      end
      source = source.gsub(%r{\]\((/[^)\s]*)\)}) { "](#{base}#{Regexp.last_match(1)})" }
      source.gsub(/\n{3,}/, "\n\n").strip
    end

    def strip_html(text)
      text.gsub(/<[^>]+>/, "").gsub(/\s+/, " ").strip
    end

    # ------------------------------------------------------------ Agent：主干 / 分支 / 叶子

    def agent_files(m)
      base = m["site"]
      p = m["profile"]
      files = {}
      branches = [
        ["/agent/profile.md", "身份与简介", "姓名、学校、方向、学术主页与网址"],
        ["/agent/writings.md", "文章", "#{m['writings'].size} 篇，每篇都有全文 Markdown"],
        ["/agent/projects.md", "项目与研究", "#{m['projects'].size} 项，按研究 / 项目 / 工具分组"],
        ["/agent/news.md", "动态", "#{m['news'].size} 条"],
        ["/agent/contact.md", "联系方式", "公开给 Agent 的联系入口"],
        ["/agent/interfaces.md", "接口说明", "全部机器入口、JSON 接口、站内搜索索引"],
      ]
      up = "> 上级：[主干 llms.txt](#{base}/llms.txt) · 浏览器版：#{base}/"

      trunk = []
      trunk << "# #{p['name']} · #{p['brand']}" << "" << "> #{p['headline']}" << ""
      trunk << "你好，Agent。这里是#{p['name']}个人主页的机器可读版本，这份文件是主干：" \
               "下面每个分支都是一份独立的 Markdown 或 JSON，按需读取，不必一次读完。"
      trunk << "内容与网页由同一份源文件生成，不含额外信息；引用时请以各条目的原文链接为准。"
      trunk << "终端里的人类访客请用：`#{launch(base)}`" << ""
      trunk << "## 分支" << ""
      branches.each { |path, title, note| trunk << "- [#{title}](#{base}#{path})：#{note}" }
      trunk << "" << "## 文章" << ""
      m["writings"].each { |w| trunk << "- [#{w['title']}](#{w['md']})：#{w['date']} · #{w['description']}" }
      trunk << "" << "## 项目与研究" << ""
      m["projects"].each { |pr| trunk << "- [#{pr['title']}](#{pr['md']})：#{pr['kind_label']} · #{pr['description']}" }
      trunk << "" << "## 结构化数据" << ""
      api_index(base).each { |path, note| trunk << "- [#{path.sub('/api/', '')}](#{base}#{path})：#{note}" }
      trunk << "" << "## Optional" << ""
      trunk << "- [全文合集 llms-full.txt](#{base}/llms-full.txt)：全部文章、项目与动态的正文，一次读完"
      trunk << "- [#{p['academic']['label']}](#{p['academic']['url']})：英文"
      files["/llms.txt"] = trunk.join("\n") + "\n"

      profile = ["# 身份与简介 · #{p['name']}", "", up, ""]
      profile << "- 姓名：#{p['name']}（#{p['name_latin']}）"
      p["segments"].each { |segment| profile << "- #{segment}" }
      profile << "- 网站：#{base}/（国内镜像 #{p['mirror']}）"
      profile << "- #{p['academic']['label']}：#{p['academic']['url']}"
      profile << "" << "## 栏目" << ""
      m["sections"].each { |s| profile << "- [#{s['title']}](#{base}#{leaf(s['url'])})" }
      files["/agent/profile.md"] = profile.join("\n") + "\n"

      writings = ["# 文章 · #{p['name']}", "", up, "", "共 #{m['writings'].size} 篇，按时间倒序。每条链接是全文的 Markdown 版。", ""]
      m["writings"].each do |w|
        writings << "## [#{w['title']}](#{w['md']})" << ""
        writings << "- 日期：#{w['date']}"
        writings << "- 分类：#{w['categories'].join('、')}" unless w["categories"].empty?
        writings << "- 标签：#{w['tags'].join('、')}" unless w["tags"].empty?
        writings << "- 网页：#{w['url']}"
        writings << "" << w["description"] unless w["description"].empty?
        writings << ""
      end
      files["/agent/writings.md"] = writings.join("\n")

      projects = ["# 项目与研究 · #{p['name']}", "", up, ""]
      KIND_ORDER.each do |kind|
        group = m["projects"].select { |pr| pr["kind"] == kind }
        next if group.empty?

        projects << "## #{KIND_LABELS[kind]}" << ""
        group.each { |pr| projects << "- [#{pr['title']}](#{pr['md']})：#{pr['description']}（网页 #{pr['url']}）" }
        projects << ""
      end
      files["/agent/projects.md"] = projects.join("\n")

      news = ["# 动态 · #{p['name']}", "", up, ""]
      m["news"].each { |n| news << "- #{n['date']} [#{n['title']}](#{n['md']})" }
      files["/agent/news.md"] = news.join("\n") + "\n"

      contact = ["# 联系方式 · #{p['name']}", "", up, ""]
      m["contacts_agent"].each { |c| contact << "- #{c['label']}：#{c['url'] || c['value']}" }
      contact << "- #{p['academic']['label']}：#{p['academic']['url']}"
      contact << "" << "其他联系方式（QQ、微信）只在网页和终端版里提供。"
      files["/agent/contact.md"] = contact.join("\n") + "\n"

      interfaces = ["# 接口说明 · #{p['name']}", "", up, "", "全部是静态文件，无需鉴权，内容随网站每次发布更新。", ""]
      interfaces << "## Markdown" << ""
      interfaces << "- 主干：#{base}/llms.txt"
      branches.each { |path, title, _note| interfaces << "- 分支 · #{title}：#{base}#{path}" }
      interfaces << "- 叶子：任一文章、项目、动态或栏目页的网址后加 `index.html.md`，例如 #{m['writings'].first&.dig('md') || "#{base}/index.html.md"}"
      interfaces << "- 全文合集：#{base}/llms-full.txt"
      interfaces << "" << "## JSON" << ""
      api_index(base).each { |path, note| interfaces << "- #{base}#{path}：#{note}" }
      interfaces << "- 站内搜索索引：#{base}/assets/search/index-zh.json（构建时生成的分块索引，浏览器端 BM25 检索用）"
      interfaces << "" << "## 终端（给人看，含颜色码，Agent 不必读取）" << ""
      interfaces << "- 彩色名片：#{base}/cli"
      interfaces << "- 交互界面：`#{launch(base)}`（装成命令：`#{launch(base)} -s install`）"
      if m["mirror_negotiation"]
        interfaces << "" << "## 内容协商（国内镜像 https://fanyuchen.com.cn）" << ""
        interfaces << "- `Accept: text/markdown`：任意页面返回对应的 Markdown 版"
        interfaces << "- `Accept: application/json` 访问 `/`：返回 /api/profile.json"
        interfaces << "- curl / wget / HTTPie：返回彩色名片"
      end
      files["/agent/interfaces.md"] = interfaces.join("\n") + "\n"

      # 叶子：栏目页
      m["sections"].each do |section|
        files[leaf(section["url"])] =
          case section["key"]
          when "home" then trunk.join("\n") + "\n"
          when "writings" then files["/agent/writings.md"]
          when "projects" then files["/agent/projects.md"]
          when "news" then files["/agent/news.md"]
          when "tools"
            tools = m["projects"].select { |pr| pr["kind"] == "tool" }
            (["# 工具 · #{p['name']}", "", up, ""] + tools.map { |pr| "- [#{pr['title']}](#{pr['md']})：#{pr['description']}" }).join("\n") + "\n"
          end
      end
      # 叶子：每篇文章、项目、动态
      (m["writings"] + m["projects"] + m["news"]).each do |item|
        meta = [item["date"], item["kind_label"], *Array(item["categories"])].compact.reject(&:empty?).join(" · ")
        leaf_text = ["# #{item['title']}", "", "> 原文：#{item['url']} · 上级：#{base}/llms.txt", ""]
        leaf_text << meta << "" unless meta.empty?
        leaf_text << item["body"].to_s
        files[item["md"].delete_prefix(base)] = leaf_text.join("\n").rstrip + "\n"
      end

      full = [trunk.first, "", "> #{p['headline']}", "", "全部公开文章、项目与动态的正文。主干与分支见 #{base}/llms.txt", ""]
      [["文章", m["writings"]], ["项目与研究", m["projects"]], ["动态", m["news"]]].each do |title, items|
        full << "# #{title}" << ""
        items.each do |item|
          full << "## #{item['title']}" << "" << "原文：#{item['url']}" << ""
          full << item["body"].to_s << ""
        end
      end
      files["/llms-full.txt"] = full.join("\n")

      files.merge(api_files(m))
    end

    def api_index(base)
      [
        ["/api/profile.json", "身份、简介、学术主页、网址"],
        ["/api/writings.json", "文章列表（标题、日期、分类、标签、摘要、网页与 Markdown 地址）"],
        ["/api/projects.json", "项目、研究与工具"],
        ["/api/news.json", "动态"],
        ["/api/interfaces.json", "全部机器入口"],
      ]
    end

    def api_files(m)
      base = m["site"]
      p = m["profile"]
      meta = { "说明" => "#{p['name']}个人主页的结构化数据，与网页同源生成；引用请以 url 指向的原文为准。",
               "updated" => m["version"], "trunk" => "#{base}/llms.txt" }
      strip = ->(items) { items.map { |item| item.reject { |key, _| key == "body" } } }
      {
        "/api/profile.json" => meta.merge(
          "name" => p["name"], "name_latin" => p["name_latin"], "brand" => p["brand"],
          "headline" => p["headline"], "segments" => p["segments"],
          "academic" => p["academic"], "site" => "#{base}/", "mirror" => p["mirror"],
          "contacts" => m["contacts_agent"].map { |c| { "label" => c["label"], "url" => c["url"] || c["value"] } }
        ),
        "/api/writings.json" => meta.merge("count" => m["writings"].size, "items" => strip.call(m["writings"])),
        "/api/projects.json" => meta.merge("count" => m["projects"].size, "items" => strip.call(m["projects"])),
        "/api/news.json" => meta.merge("count" => m["news"].size, "items" => strip.call(m["news"])),
        "/api/interfaces.json" => meta.merge(
          "markdown" => { "trunk" => "#{base}/llms.txt", "full" => "#{base}/llms-full.txt",
                          "branches" => %w[profile writings projects news contact interfaces].map { |b| "#{base}/agent/#{b}.md" },
                          "leaf_rule" => "页面网址后加 index.html.md" },
          "json" => api_index(base).map { |path, note| { "url" => base + path, "说明" => note } },
          "search_index" => "#{base}/assets/search/index-zh.json",
          "terminal" => { "card" => "#{base}/cli", "interactive" => launch(base), "install" => "#{launch(base)} -s install" }
        ),
      }.transform_values { |value| JSON.pretty_generate(value) + "\n" }
    end

    # ------------------------------------------------------------ 终端

    def terminal_data(m)
      {
        "site" => m["site"],
        "version" => m["version"],
        "profile" => m["profile"],
        "contacts" => m["contacts_terminal"].map { |c| { "label" => c["label"], "value" => c["value"].to_s } },
        "qr" => m["qr"],
        "writings" => m["writings"],
        "projects" => m["projects"],
        "news" => m["news"],
        "launch" => launch(m["site"]),
        "agent_entries" => [["主干", "/llms.txt"], ["全文", "/llms-full.txt"], ["文章 JSON", "/api/writings.json"],
                            ["接口说明", "/agent/interfaces.md"]],
      }
    end

    def write_terminal(site, m)
      template = File.read(File.join(site.source, "terminal", "cli.py"), encoding: "UTF-8")
      placeholder = "DATA = None  # @@HEADLESS_DATA@@"
      raise Jekyll::Errors::FatalException, "terminal/cli.py: data placeholder missing" unless template.include?(placeholder)

      literal = JSON.generate(JSON.generate(terminal_data(m)))
      script = template.sub(placeholder) { "DATA = json.loads(#{literal})" }
      script_path = File.join(site.dest, "cli.py")
      File.write(script_path, script)

      output, error, status = Open3.capture3({ "NO_COLOR" => nil, "COLUMNS" => "80" }, "python3", script_path, "--card")
      unless status.success?
        Jekyll.logger.warn "Headless:", "python3 cli.py --card failed, /cli not generated: #{error.lines.last}"
        return
      end
      File.write(File.join(site.dest, "cli"), output)
      FileUtils.cp(File.join(site.source, "terminal", "sh"), File.join(site.dest, "sh"))
    rescue Errno::ENOENT
      Jekyll.logger.warn "Headless:", "python3 not found, /cli not generated"
    end

    # ------------------------------------------------------------ HTML 里的入口提示

    def annotate(html, base, markdown_url)
      return html if html.include?(MARKER) || !html.include?("</head>")

      comment = "<!-- #{MARKER} · 终端：#{launch(base)} · Agent：#{base}/llms.txt -->\n"
      links = %(<link rel="alternate" type="text/plain" href="#{base}/llms.txt" title="llms.txt">)
      links += %(<link rel="alternate" type="text/markdown" href="#{markdown_url}" title="Markdown">) if markdown_url
      comment + html.sub("</head>") { "#{links}</head>" }
    end
  end
end

Jekyll::Hooks.register :site, :post_write do |site|
  helper = Functionhx::HeadlessSite
  m = helper.model(site)
  m["qr"] = Array(site.data.dig("terminal_qr", "rows"))
  files = helper.agent_files(m)
  files.each do |path, content|
    target = File.join(site.dest, path)
    FileUtils.mkdir_p(File.dirname(target))
    File.write(target, content)
  end
  helper.write_terminal(site, m)

  base = m["site"]
  (site.pages + site.documents).each do |item|
    next unless item.write? && item.output_ext == ".html"

    path = item.destination(site.dest)
    next unless File.file?(path)

    markdown = helper.leaf(item.url)
    markdown_url = files.key?(markdown) ? base + markdown : nil
    html = File.read(path, encoding: "UTF-8")
    updated = helper.annotate(html, base, markdown_url)
    File.write(path, updated) unless updated == html
  end
end
