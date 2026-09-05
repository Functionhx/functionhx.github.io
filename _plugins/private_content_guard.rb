# frozen_string_literal: true

# Search exclusion is not access control: Jekyll would otherwise render a
# private record at its permalink and include it in feeds or other collections.
# Fail closed before any generator builds public lists. Private prose must stay
# in the encrypted Spark Vault, never in this public repository or its build.
module Functionhx
  class PrivateContentGuard < Jekyll::Generator
    safe true
    priority :highest

    def generate(site)
      records = site.pages + site.collections.values.flat_map(&:docs)
      private_records = records.select do |record|
        data = record.data
        data["private"] == true || data["published"] == false || data["draft"] == true || %w[private owner draft].include?(data["visibility"])
      end
      return if private_records.empty?

      paths = private_records.map(&:path).join(", ")
      raise Jekyll::Errors::FatalException,
        "Private content cannot enter a public static build: #{paths}. Store it in the encrypted vault."
    end
  end
end
