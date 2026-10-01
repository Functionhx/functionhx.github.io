# frozen_string_literal: true

# 给没有数字宽高的站内图片补上 aspect-ratio，图片加载前就占好位置，避免布局跳动（CLS）。
#
# 主题的 figure.liquid 输出 width="100%" height="auto"：浏览器只知道宽度，不知道高度，图片一到
# 下面的内容就被整段推下去（论文页的预览图实测 CLS 0.38）。这里在构建时读图片文件头拿到真实尺寸，
# 只追加 style="aspect-ratio: W / H"，不改原有的 width/height 属性和主题样式，所以显示尺寸不变。
# 远程图片（GitHub 统计卡片等）尺寸未知，不处理。
module Functionhx
  module ImageAspectRatio
    IMG = /<img\b[^>]*>/i
    @dimensions = {}

    module_function

    def rewrite(html, source_dir)
      html.gsub(IMG) do |tag|
        next tag if tag.match?(/\bstyle=["'][^"']*aspect-ratio/i)
        next tag if numeric?(tag, "width") && numeric?(tag, "height")

        src = tag[/\bsrc=["']([^"']+)["']/i, 1]
        next tag unless src&.start_with?("/") && !src.start_with?("//")

        size = dimensions(File.join(source_dir, src.sub(/[?#].*\z/, "")))
        next tag unless size

        ratio = "aspect-ratio: #{size[0]} / #{size[1]}"
        if tag.match?(/\bstyle="/i)
          tag.sub(/\bstyle="([^"]*)"/i) { %(style="#{Regexp.last_match(1).sub(/;?\s*\z/, '; ')}#{ratio}") }
        else
          tag.sub(/\s*\/?>\z/) { %( style="#{ratio}">) }
        end
      end
    end

    def numeric?(tag, attribute)
      tag.match?(/\b#{attribute}=["']?\d+["'\s>]/i)
    end

    def dimensions(path)
      return @dimensions[path] if @dimensions.key?(path)

      @dimensions[path] = File.file?(path) ? read_dimensions(path) : nil
    rescue StandardError
      @dimensions[path] = nil
    end

    def read_dimensions(path)
      File.open(path, "rb") do |file|
        head = file.read(64) || ""
        if head.start_with?("\x89PNG".b)
          head[16, 8].unpack("NN")
        elsif head.start_with?("GIF8")
          head[6, 4].unpack("vv")
        elsif head.start_with?("RIFF") && head[8, 4] == "WEBP"
          webp_dimensions(head)
        elsif head.start_with?("\xFF\xD8".b)
          file.rewind
          jpeg_dimensions(file)
        end
      end
    end

    def webp_dimensions(head)
      case head[12, 4]
      when "VP8 " then head[26, 4].unpack("vv").map { |value| value & 0x3FFF }
      when "VP8L"
        bits = head[21, 4].unpack1("V")
        [(bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1]
      when "VP8X"
        width = head[24, 3].unpack("C3")
        height = head[27, 3].unpack("C3")
        [width[0] | (width[1] << 8) | (width[2] << 16), height[0] | (height[1] << 8) | (height[2] << 16)].map { |v| v + 1 }
      end
    end

    def jpeg_dimensions(file)
      file.read(2)
      loop do
        marker = file.read(2)&.bytes
        return nil unless marker && marker[0] == 0xFF

        length = file.read(2).unpack1("n")
        if (0xC0..0xCF).cover?(marker[1]) && ![0xC4, 0xC8, 0xCC].include?(marker[1])
          height, width = file.read(5).unpack("xnn")
          return [width, height]
        end
        file.seek(length - 2, IO::SEEK_CUR)
      end
    end
  end
end

Jekyll::Hooks.register [:pages, :documents], :post_render do |item|
  next unless item.output_ext == ".html" && item.output

  item.output = Functionhx::ImageAspectRatio.rewrite(item.output, item.site.source)
end
