# frozen_string_literal: true

# 发布时区（站长设置，_data/site_ui.yml 的 publish_timezone，默认北京时间）。
#
# 没有它，文章日期跟着构建机器的时区走：CI 在 UTC，北京时间早上 8 点前发的文章
# 会显示成前一天。值存在 site_ui.yml 而不是 _config.yml 的 timezone，是为了让
# 设置面板沿用它已有的写入路径；这里在读取内容之前把它设成 Jekyll 的时区。
require "yaml"

module FunctionhxPublishTimezone
  DEFAULT = "Asia/Shanghai"

  module_function

  def read_yaml(path)
    File.exist?(path) ? YAML.safe_load(File.read(path, encoding: "UTF-8")) : nil
  rescue Psych::Exception
    nil
  end

  def resolve(source)
    choices = Array(read_yaml(File.join(source, "_data", "publish_timezones.yml"))).filter_map do |item|
      item["id"] if item.is_a?(Hash)
    end
    settings = read_yaml(File.join(source, "_data", "site_ui.yml"))
    zone = settings.is_a?(Hash) ? settings["publish_timezone"] : nil
    return zone if zone.is_a?(String) && choices.include?(zone)

    Jekyll.logger.warn "Publish timezone:", "#{zone.inspect} is not an allowed choice; using #{DEFAULT}" if zone
    DEFAULT
  end
end

Jekyll::Hooks.register :site, :after_init do |site|
  zone = FunctionhxPublishTimezone.resolve(site.source)
  site.config["timezone"] = zone
  Jekyll.set_timezone(zone)
end
