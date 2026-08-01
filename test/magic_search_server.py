#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "functionhx_magic_search", ROOT / "magic-search" / "server.py"
)
assert SPEC and SPEC.loader
SERVER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SERVER
SPEC.loader.exec_module(SERVER)


class FakeEmbedder:
    def __init__(self) -> None:
        self.batches: list[list[str]] = []

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.batches.append(list(texts))
        vectors = []
        for text in texts:
            vector = [0.0] * 24
            for token in text.lower().split():
                slot = int(hashlib.sha256(token.encode()).hexdigest()[:8], 16) % len(vector)
                vector[slot] += 1.0
            vector[0] += 0.01
            vectors.append(vector)
        return vectors


def write_index(directory: Path, language: str, suffix: str = "") -> None:
    chunks = [
        {
            "id": f"robot-{language}",
            "content_hash": f"robot-hash-{language}{suffix}",
            "chain": ["Tools", "Robot"],
            "title": "Robot",
            "heading": "Control",
            "text": f"robot control localization {suffix}",
        },
        {
            "id": f"essay-{language}",
            "content_hash": f"essay-hash-{language}",
            "chain": ["Blog", "Essay"],
            "title": "Essay",
            "heading": "Writing",
            "text": "essay writing publication",
        },
    ]
    payload = {"version": 1, "language": language, "chunks": chunks}
    (directory / f"index-{language}.json").write_text(json.dumps(payload), encoding="utf-8")


class SemanticSearchEngineTest(unittest.TestCase):
    def test_incremental_cache_and_ranking(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            indexes = root / "indexes"
            indexes.mkdir()
            write_index(indexes, "zh")
            write_index(indexes, "en")
            embedder = FakeEmbedder()
            engine = SERVER.SemanticSearchEngine(
                indexes,
                root / "state" / "embeddings.sqlite3",
                "fake-model",
                root / "cache",
                embedder_factory=lambda _name, _cache: embedder,
            )

            loaded = engine.ensure_loaded("zh")
            self.assertEqual(len(loaded.chunks), 2)
            self.assertEqual(sum(len(batch) for batch in embedder.batches), 2)

            engine.ensure_loaded("zh")
            self.assertEqual(sum(len(batch) for batch in embedder.batches), 2)

            results = engine.search("robot control", "zh", 2)
            self.assertEqual(results[0]["id"], "robot-zh")
            self.assertEqual(sum(len(batch) for batch in embedder.batches), 3)

            write_index(indexes, "zh", "changed")
            engine.ensure_loaded("zh")
            self.assertEqual(sum(len(batch) for batch in embedder.batches), 4)

            second_embedder = FakeEmbedder()
            second_engine = SERVER.SemanticSearchEngine(
                indexes,
                root / "state" / "embeddings.sqlite3",
                "fake-model",
                root / "cache",
                embedder_factory=lambda _name, _cache: second_embedder,
            )
            second_engine.ensure_loaded("zh")
            self.assertEqual(second_embedder.batches, [])

    def test_vector_round_trip(self) -> None:
        vector = SERVER.normalized_vector([3.0, 4.0])
        restored = SERVER.unpack_vector(SERVER.pack_vector(vector))
        self.assertAlmostEqual(SERVER.dot(restored, restored), 1.0, places=5)


if __name__ == "__main__":
    unittest.main()
