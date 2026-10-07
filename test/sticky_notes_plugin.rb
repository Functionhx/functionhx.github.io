# frozen_string_literal: true

# 作者便利贴的构建插件（_plugins/sticky_notes.rb）：在一个临时站点里走一遍真实的 kramdown。
require "jekyll"
require "tmpdir"
require "fileutils"

def check(condition, message)
  raise message unless condition
end

Dir.mktmpdir("function-sticky-notes-") do |root|
  FileUtils.mkdir_p(["#{root}/_posts", "#{root}/_plugins", "#{root}/_layouts"])
  FileUtils.cp(File.expand_path("../_plugins/sticky_notes.rb", __dir__), "#{root}/_plugins/sticky_notes.rb")
  File.write("#{root}/_layouts/post.html", "{{ content }}")
  File.write("#{root}/_posts/2026-10-07-note.md", <<~MARKDOWN)
    ---
    layout: post
    title: 便利贴
    ---
    第一段。

    > [!便利贴] 写完半年后我改主意了。
    > 第二行。

    第二段。

    > [!便利贴 粉] 粉色的一张，带 [链接](https://example.com)。

    > 一段普通引用，[!便利贴] 不在开头。

    > [!便利贴 紫] 不认识的颜色，原样留着。
  MARKDOWN
  File.write("#{root}/about.md", "---\ntitle: 页面\n---\n> [!便利贴] 页面里不转换。\n")

  site = Jekyll::Site.new(Jekyll.configuration("source" => root, "destination" => "#{root}/_site", "quiet" => true))
  site.process
  html = File.read(Dir["#{root}/_site/**/note.html"].first || Dir["#{root}/_site/2026/**/*.html"].first)

  notes = html.scan(%r{<aside class="sticky-note sticky-note--author"[^>]*>.*?</aside>}m)
  check(notes.size == 2, "two author notes become asides, got #{notes.size}:\n#{html}")
  check(notes[0].include?('data-sticky-color="yellow"'), "the default note is yellow")
  check(notes[0].include?('role="note"') && notes[0].include?('aria-label="作者便利贴"'), "author notes are labelled notes")
  check(notes[0].include?("写完半年后我改主意了。") && notes[0].include?("第二行。"), "a note keeps every line")
  check(!notes[0].include?("[!便利贴"), "the marker is removed")
  check(notes[1].include?('data-sticky-color="pink"') && notes[1].include?('<a href="https://example.com">'), "colour words and inline Markdown survive")
  check(html.include?("<blockquote>\n  <p>一段普通引用"), "ordinary quotes stay quotes")
  check(html.include?("[!便利贴 紫]"), "an unknown colour is left alone so validate_content.py can flag it")
  check(html.index("第一段") < html.index(notes[0]) && html.index(notes[0]) < html.index("第二段"), "a note stays right after the paragraph it annotates")
  page = File.read("#{root}/_site/about.html")
  check(!page.include?("sticky-note"), "only posts are converted")
end

puts "Sticky note plugin checks passed: markers, colours, multi-line notes, ordinary quotes, and scope."
