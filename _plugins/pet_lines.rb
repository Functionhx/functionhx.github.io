# frozen_string_literal: true

require "json"

# 网站宠物的台词：_data/pet.yml → /assets/pet/lines.json（公共部分），
# _data/pets/<id>.yml → /assets/pet/<id>/lines.json（每只宠物自己的性格）。
# 浏览器只取当前那只的那份，换宠物时再取另一份。
module Functionhx
  class PetLinesGenerator < Jekyll::Generator
    safe true
    priority :low

    def generate(site)
      common = site.data["pet"]
      return unless common.is_a?(Hash)

      site.pages << json_page(site, "assets/pet", "lines.json", common)
      (site.data["pets"] || {}).each do |id, data|
        next unless data.is_a?(Hash)
        raise Jekyll::Errors::FatalException, "_data/pets/#{id}.yml: id must be #{id}" unless data["id"] == id

        site.pages << json_page(site, "assets/pet/#{id}", "lines.json", data)
      end
    end

    private

    def json_page(site, dir, name, data)
      page = Jekyll::PageWithoutAFile.new(site, site.source, dir, name)
      page.content = JSON.generate(data)
      page.data["layout"] = nil
      page.data["sitemap"] = false
      page
    end
  end
end
