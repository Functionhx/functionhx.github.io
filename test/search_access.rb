# frozen_string_literal: true

require "jekyll"
require "json"
require "tmpdir"
require "fileutils"
require "yaml"

def check(condition, message)
  raise message unless condition
end

Dir.mktmpdir("function-search-access-") do |root|
  FileUtils.mkdir_p(["#{root}/_pages", "#{root}/_books", "#{root}/_posts", "#{root}/_plugins", "#{root}/_data"])
  %w[magic_search_generator private_content_guard].each do |name|
    FileUtils.cp(File.expand_path("../_plugins/#{name}.rb", __dir__), "#{root}/_plugins/#{name}.rb")
  end
  write = lambda do |path, fields, text|
    File.write("#{root}/#{path}", "---\nlang: zh\n#{fields}\n---\n#{text}\n")
  end
  write.call("_pages/home.md", "title: Home\nhome: true\ntranslation_key: home\npermalink: /", "Home prose")
  write.call("_pages/blog.md", "title: Blog\nnav: true\ntranslation_key: blog\npermalink: /blog/", "Blog prose")
  write.call("_pages/books.md", "title: Books\nnav: false\ntranslation_key: books\npermalink: /books/", "Hidden bookshelf")
  write.call("_books/hidden.md", "title: Hidden book\ntranslation_key: hidden-book\npermalink: /books/hidden/", "HIDDEN_BOOK_SENTINEL")
  write.call("_posts/2020-01-01-public.md", "title: Public post\nkind: writing\ntranslation_key: public-post", "PUBLIC_SENTINEL")
  write.call("_posts/2020-01-02-unlisted.md", "title: Unlisted\nvisibility: unlisted\ntranslation_key: unlisted-post", "UNLISTED_SENTINEL")
  write.call("_posts/2020-01-03-demo.md", "title: Demo\ntranslation_key: demo-fixture", "DEMO_SENTINEL")
  File.write("#{root}/_data/search_expansions.yml", "{}\n")
  config = Jekyll.configuration({
    "source" => root, "destination" => "#{root}/_site", "quiet" => true,
    "include" => ["_pages"], "collections" => { "books" => { "output" => true } },
    "search_enabled" => true, "magic_search" => { "enabled" => true }
  })
  Jekyll::Site.new(config).process
  payload = File.read("#{root}/_site/assets/search/index-zh.json")
  index = JSON.parse(payload)
  check(index["audience"] == "visitor", "The static index must declare visitor scope")
  check(payload.include?("PUBLIC_SENTINEL"), "Visible public posts must remain searchable")
  %w[HIDDEN_BOOK_SENTINEL UNLISTED_SENTINEL DEMO_SENTINEL].each do |sentinel|
    check(!payload.include?(sentinel), "Excluded content leaked into the public index: #{sentinel}")
  end
  check(File.exist?("#{root}/_site/books/hidden/index.html"), "Navigation hiding is discovery control, not private storage")

  # 同义/相关问法扩展词（见 _data/search_expansions.yml）：按 content_hash 匹配，
  # 只喂给 BM25 分词，不出现在可见的 chunk 文字里；没有对应条目的 chunk 照常可搜。
  public_chunk = index["chunks"].find { |chunk| chunk["text"] == "PUBLIC_SENTINEL" }
  check(public_chunk, "Expected to find the public post chunk before testing search expansions")
  expansion_token = "expansiontokenxyz"
  File.write("#{root}/_data/search_expansions.yml", { public_chunk["content_hash"] => [expansion_token] }.to_yaml)
  Jekyll::Site.new(config).process
  expanded_payload = File.read("#{root}/_site/assets/search/index-zh.json")
  expanded_index = JSON.parse(expanded_payload)
  check(expanded_index["postings"].key?(expansion_token), "Search expansions must feed BM25 postings")
  expanded_chunk = expanded_index["chunks"].find { |chunk| chunk["content_hash"] == public_chunk["content_hash"] }
  check(!expanded_chunk["text"].include?(expansion_token), "Expansion phrases must not leak into visible chunk text")
  check(!expanded_chunk["excerpt"].include?(expansion_token), "Expansion phrases must not leak into the visible excerpt")
  other_chunk = expanded_index["chunks"].find { |chunk| chunk["content_hash"] != public_chunk["content_hash"] }
  check(other_chunk, "A chunk without a search expansion entry must still build")
  File.write("#{root}/_data/search_expansions.yml", "{}\n")

  write.call("_pages/blog.md", "title: Blog\nnav: false\ntranslation_key: blog\npermalink: /blog/", "Blog prose")
  Jekyll::Site.new(config).process
  check(!File.read("#{root}/_site/assets/search/index-zh.json").include?("PUBLIC_SENTINEL"), "A hidden section must hide its descendants from search")

  ["private: true", "visibility: private", "visibility: owner", "draft: true"].each do |flag|
    write.call("_pages/secret.md", "title: Secret\n#{flag}\ntranslation_key: secret\npermalink: /secret/", "PRIVATE_SENTINEL")
    failed = false
    begin
      Jekyll::Site.new(config).process
    rescue Jekyll::Errors::FatalException => error
      failed = error.message.include?("Private content cannot enter")
    end
    check(failed, "Public builds must fail closed for #{flag}")
    check(!File.exist?("#{root}/_site/secret/index.html"), "Private HTML must never be emitted")
  end
end
puts "Search access checks passed: visible sections, descendants, unlisted records, demos, private build guards, and search expansions."
