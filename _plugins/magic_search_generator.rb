# frozen_string_literal: true

require "digest"
require "json"
require "nokogiri"
require "set"
require "unicode_normalize/normalize"

module Functionhx
  module MagicSearch
    VERSION = 1
    LANGUAGES = %w[zh en].freeze
    MAX_CHUNK_CHARACTERS = 900

    SECTION_NAMES = {
      "zh" => {
        "posts" => "博客",
        "spark" => "闪耀",
        "projects" => "项目",
        "tools" => "工具",
        "news" => "动态",
        "books" => "书架",
        "teachings" => "教学"
      },
      "en" => {
        "posts" => "Blog",
        "spark" => "Spark",
        "projects" => "Projects",
        "tools" => "Tools",
        "news" => "News",
        "books" => "Books",
        "teachings" => "Teaching"
      }
    }.freeze

    PAGE_SECTIONS = {
      "about" => { "zh" => "关于", "en" => "About" },
      "home" => { "zh" => "关于", "en" => "About" },
      "blog" => { "zh" => "博客", "en" => "Blog" },
      "spark" => { "zh" => "闪耀", "en" => "Spark" },
      "notes" => { "zh" => "闪耀", "en" => "Spark" },
      "logs" => { "zh" => "闪耀", "en" => "Spark" },
      "tools" => { "zh" => "工具", "en" => "Tools" },
      "projects" => { "zh" => "项目", "en" => "Projects" },
      "news" => { "zh" => "动态", "en" => "News" }
    }.freeze

    # A generated JSON page whose content must never pass through Liquid. Code
    # snippets in indexed articles may contain {{...}} and must remain literal.
    class JsonPage < Jekyll::PageWithoutAFile
      def initialize(site, language, payload)
        super(site, site.source, "assets/search", "index-#{language}.json")
        self.content = JSON.generate(payload)
        self.data = {
          "layout" => nil,
          "render_with_liquid" => false,
          "sitemap" => false
        }
      end
    end

    class Generator < Jekyll::Generator
      safe true
      priority :lowest

      def generate(site)
        config = site.config.fetch("magic_search", {})
        return unless site.config["search_enabled"] && config.fetch("enabled", true)

        @site = site
        @markdown = site.find_converter_instance(Jekyll::Converters::Markdown)

        LANGUAGES.each do |language|
          payload = build_index(language, config)
          site.pages << JsonPage.new(site, language, payload)
          Jekyll.logger.info(
            "Magic Search:",
            "#{language}: #{payload[:documents].length} documents, " \
            "#{payload[:chunks].length} chunks"
          )
        end
      end

      private

      def build_index(language, config)
        documents = []
        chunks = []

        public_records(language).sort_by { |record| [record.url.to_s, record.path.to_s] }.each do |record|
          document = document_metadata(record, language, documents.length)
          document_chunks = extract_chunks(record, document)
          next if document_chunks.empty?

          document[:chunk_start] = chunks.length
          document[:chunk_count] = document_chunks.length
          documents << document
          chunks.concat(document_chunks)
        end

        postings = Hash.new { |hash, token| hash[token] = [] }
        chunks.each_with_index do |chunk, chunk_index|
          frequencies = Hash.new(0)
          weighted_text = [
            chunk[:title], chunk[:title], chunk[:title],
            chunk[:chain].join(" "), chunk[:chain].join(" "),
            chunk[:tags].join(" "), chunk[:categories].join(" "),
            chunk[:text]
          ].join(" ")
          tokens = tokenize(weighted_text)
          tokens.each { |token| frequencies[token] += 1 }
          chunk[:length] = [tokens.length, 1].max
          frequencies.each { |token, frequency| postings[token] << [chunk_index, frequency] }
        end

        average_length = if chunks.empty?
                           1.0
                         else
                           chunks.sum { |chunk| chunk[:length] }.to_f / chunks.length
                         end

        {
          version: VERSION,
          language: language,
          semantic_endpoint: config["semantic_endpoint"].to_s,
          document_count: documents.length,
          chunk_count: chunks.length,
          average_length: average_length.round(3),
          documents: documents,
          chunks: chunks,
          postings: postings.sort.to_h
        }
      end

      def public_records(language)
        pages = @site.pages.reject { |page| page.is_a?(JsonPage) }
        collection_documents = @site.collections.values.flat_map(&:docs)

        (pages + collection_documents).uniq.select do |record|
          data = record.data
          data["lang"] == language &&
            data["published"] != false &&
            data["private"] != true &&
            data["visibility"] != "private" &&
            data["search_exclude"] != true &&
            data["translation_key"] != "search" &&
            data["autogen"].nil? &&
            !record.url.to_s.empty?
        end
      end

      def document_metadata(record, language, index)
        data = record.data
        collection = record.respond_to?(:collection) && record.collection ? record.collection.label : "pages"
        title = normalize_text(data["title"] || data["name"] || record.basename_without_ext)
        section = section_name(collection, data, language, title)
        kind = data["kind"].to_s.empty? ? collection : data["kind"].to_s
        tags = array_text(data["tags"])
        categories = array_text(data["categories"] || data["category"])
        explicit_path = array_text(data["search_path"])
        base_chain = explicit_path.empty? ? unique_chain([section, title]) : unique_chain(explicit_path)
        stable_source = record.respond_to?(:relative_path) ? record.relative_path : record.path

        {
          id: "doc-#{Digest::SHA256.hexdigest(stable_source.to_s)[0, 14]}",
          index: index,
          translation_key: data["translation_key"].to_s,
          kind: kind,
          section: section,
          title: title,
          description: normalize_text(data["description"]),
          url: record.url.to_s,
          date: normalize_date(data["date"]),
          tags: tags,
          categories: categories,
          chain: base_chain
        }
      end

      def section_name(collection, data, language, title)
        if collection == "posts"
          return SECTION_NAMES.fetch(language).fetch("spark") if %w[note log].include?(data["kind"])

          return SECTION_NAMES.fetch(language).fetch("posts")
        end
        if collection == "projects"
          return SECTION_NAMES.fetch(language).fetch("tools") if data["kind"] == "tool"

          return SECTION_NAMES.fetch(language).fetch("projects")
        end
        return SECTION_NAMES.fetch(language)[collection] if SECTION_NAMES.fetch(language).key?(collection)

        key = data["translation_key"].to_s
        PAGE_SECTIONS.fetch(key, {}).fetch(language, title)
      end

      def extract_chunks(record, document)
        raw_content = record.content.to_s
        # Index authored prose, not generated editor controls or Liquid templates.
        authored_content = raw_content
          .gsub(/{%\s*(?:raw|comment)\s*%}.*?{%\s*end(?:raw|comment)\s*%}/m, " ")
          .gsub(/{%.*?%}/m, " ")
          .gsub(/{{.*?}}/m, " ")
        html = @markdown.convert(authored_content)
        fragment = Nokogiri::HTML.fragment(html)
        fragment.css("script, style, noscript, template, svg").remove

        chunks = []
        heading = ""
        anchor = ""
        buffer = []
        description = document[:description]
        buffer << description unless description.empty?

        flush = lambda do
          text = normalize_text(buffer.join(" "))
          buffer.clear
          next if text.empty?

          split_text(text).each_with_index do |piece, piece_index|
            chunk_text = normalize_text(piece)
            next if chunk_text.empty?

            chain = unique_chain(document[:chain] + [heading])
            digest_input = [document[:id], heading, chunk_text].join("\0")
            chunks << {
              id: "chunk-#{Digest::SHA256.hexdigest(digest_input)[0, 18]}",
              document: document[:index],
              title: document[:title],
              heading: heading,
              anchor: anchor,
              url: anchor.empty? ? document[:url] : "#{document[:url]}##{anchor}",
              chain: chain,
              tags: document[:tags],
              categories: document[:categories],
              text: chunk_text,
              excerpt: chunk_text[0, 220],
              content_hash: Digest::SHA256.hexdigest([document[:title], heading, chunk_text].join("\0")),
              part: piece_index + 1
            }
          end
        end

        searchable_nodes(fragment).each do |node|
          if node.name.match?(/\Ah[1-6]\z/)
            flush.call
            heading = normalize_text(node.text)
            anchor = node["id"].to_s
          else
            text = normalize_text(node.text)
            next if text.empty?

            if buffer.join(" ").length + text.length > MAX_CHUNK_CHARACTERS
              flush.call
            end
            buffer << text
          end
        end
        flush.call

        if chunks.empty? && (!document[:title].empty? || !description.empty?)
          text = normalize_text([document[:title], description].join(" "))
          chunks << {
            id: "chunk-#{Digest::SHA256.hexdigest([document[:id], text].join("\0"))[0, 18]}",
            document: document[:index],
            title: document[:title],
            heading: "",
            anchor: "",
            url: document[:url],
            chain: document[:chain],
            tags: document[:tags],
            categories: document[:categories],
            text: text,
            excerpt: text[0, 220],
            content_hash: Digest::SHA256.hexdigest(text),
            part: 1
          }
        end

        chunks
      rescue StandardError => error
        Jekyll.logger.warn "Magic Search:", "skipping #{record.path}: #{error.message}"
        []
      end

      def searchable_nodes(fragment)
        fragment.css("h1, h2, h3, h4, h5, h6, p, pre, tr, dt, dd, li").select do |node|
          next true if node.name.match?(/\Ah[1-6]\z/)
          next false if node.name == "li" && node.at_css("li, p")

          node.ancestors.none? do |ancestor|
            %w[p pre tr dt dd].include?(ancestor.name) ||
              (ancestor.name == "li" && node.name != "p")
          end
        end
      end

      def tokenize(value)
        normalized = value.to_s.unicode_normalize(:nfkc).downcase
        tokens = normalized.scan(/[a-z0-9]+(?:[-_][a-z0-9]+)*/)
        normalized.scan(/[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]+/).each do |sequence|
          characters = sequence.each_char.to_a
          if characters.length == 1
            tokens << characters.first
          else
            characters.each_cons(2) { |left, right| tokens << "#{left}#{right}" }
          end
        end
        tokens.reject { |token| token.length > 64 }
      end

      def array_text(value)
        Array(value).flatten.compact.map { |item| normalize_text(item) }.reject(&:empty?)
      end

      def split_text(value)
        remaining = value.dup
        pieces = []
        while remaining.length > MAX_CHUNK_CHARACTERS
          boundary = remaining.rindex(" ", MAX_CHUNK_CHARACTERS)
          boundary = MAX_CHUNK_CHARACTERS if boundary.nil? || boundary < (MAX_CHUNK_CHARACTERS / 2)
          pieces << remaining.slice!(0, boundary).strip
          remaining = remaining.lstrip
        end
        pieces << remaining unless remaining.empty?
        pieces
      end

      def unique_chain(values)
        values.map { |value| normalize_text(value) }.reject(&:empty?).each_with_object([]) do |value, result|
          result << value unless result.last == value
        end
      end

      def normalize_text(value)
        value.to_s.gsub(/<[^>]+>/, " ").gsub(/\s+/, " ").strip
      end

      def normalize_date(value)
        return "" if value.nil?
        return value.strftime("%Y-%m-%d") if value.respond_to?(:strftime)

        value.to_s[0, 10]
      end
    end
  end
end
