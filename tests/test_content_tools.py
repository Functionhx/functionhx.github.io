from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from content_utils import render_document, source_hash, split_document  # noqa: E402
from translate import (  # noqa: E402
    TranslationError,
    prepare_translation,
    protect_document,
    restore_document,
    structure,
    target_protection,
)


class ContentUtilityTests(unittest.TestCase):
    def test_front_matter_round_trip(self) -> None:
        source = "---\ntitle: 测试\ndraft: false\n---\n\n正文\n"
        metadata, body = split_document(source)
        rendered = render_document(metadata, body)
        reparsed, reparsed_body = split_document(rendered)
        self.assertEqual(metadata, reparsed)
        self.assertEqual(body.strip(), reparsed_body.strip())

    def test_protected_blocks_round_trip(self) -> None:
        source = "Use `hugo --minify`, https://example.com, and $x^2$.\n\n```bash\nhugo server\n```"
        masked, protected = protect_document(source)
        self.assertNotIn("https://example.com", masked)
        self.assertEqual(source, restore_document(masked, protected))

    def test_changed_protected_token_is_rejected(self) -> None:
        masked, protected = protect_document("Open https://example.com")
        damaged = masked.replace("0000", "9999")
        with self.assertRaises(TranslationError):
            restore_document(damaged, protected)

    def test_structure_ignores_translation_metadata(self) -> None:
        source = {"title": "中文", "tags": ["A"], "translation": {"status": "canonical"}}
        target = {"title": "English", "tags": ["B"], "translation": {"model": "test", "reviewed": False}}
        self.assertEqual(structure(source), structure(target))

    def test_prepare_translation_records_relative_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "content" / "zh" / "notes" / "test.md"
            target = root / "content" / "en" / "notes" / "test.md"
            source.parent.mkdir(parents=True)
            target.parent.mkdir(parents=True)
            source_text = "---\ntitle: 测试\ntranslationKey: test\ntranslation:\n  status: canonical\n---\n\n# 标题\n"
            response = "---\ntitle: Test\ntranslationKey: test\ntranslation:\n  status: canonical\n---\n\n# Heading\n"
            source.write_text(source_text, encoding="utf-8")
            with patch("translate.call_deepseek", return_value=response):
                translated, digest, _ = prepare_translation(
                    source,
                    target,
                    "prompt",
                    "test-key",
                    "test-model",
                    "https://example.invalid",
                    root,
                )
            metadata, _ = split_document(translated)
            self.assertEqual(metadata["translation"]["source"], "content/zh/notes/test.md")
            self.assertEqual(metadata["translation"]["source_hash"], source_hash(source_text))
            self.assertEqual(digest, source_hash(source_text))

    def test_reviewed_target_is_protected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "target.md"
            target.write_text(
                "---\ntitle: Reviewed\ntranslation:\n  reviewed: true\n---\n",
                encoding="utf-8",
            )
            self.assertEqual(target_protection(target), "target translation is reviewed")


if __name__ == "__main__":
    unittest.main()
