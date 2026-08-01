#!/usr/bin/env python3
"""Small multilingual semantic-retrieval service for the public site index.

The service never generates prose. It embeds the query, compares it with public
build-time chunks, and returns chunk IDs plus similarity scores. Embeddings are
cached by content hash, so a deployment computes only new or changed chunks.
"""

from __future__ import annotations

from array import array
from collections import OrderedDict, defaultdict, deque
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import math
import os
from pathlib import Path
import sqlite3
import threading
import time
from typing import Callable, Iterable, Sequence


LOGGER = logging.getLogger("functionhx.magic_search")
SUPPORTED_LANGUAGES = {"zh", "en"}
DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MAX_BODY_BYTES = 8 * 1024
MAX_QUERY_CHARACTERS = 512


def normalized_vector(values: Iterable[float]) -> tuple[float, ...]:
    vector = tuple(float(value) for value in values)
    norm = math.sqrt(sum(value * value for value in vector))
    if norm <= 0:
        raise ValueError("embedding has zero length")
    return tuple(value / norm for value in vector)


def pack_vector(values: Sequence[float]) -> bytes:
    return array("f", values).tobytes()


def unpack_vector(payload: bytes) -> tuple[float, ...]:
    values = array("f")
    values.frombytes(payload)
    return tuple(values)


def dot(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right):
        raise ValueError("embedding dimensions do not match")
    return sum(a * b for a, b in zip(left, right))


@dataclass(frozen=True)
class SearchChunk:
    id: str
    content_hash: str
    embedding_text: str


@dataclass(frozen=True)
class LoadedIndex:
    signature: tuple[int, int]
    chunks: tuple[SearchChunk, ...]
    vectors: tuple[tuple[float, ...], ...]


class FastEmbedModel:
    def __init__(self, model_name: str, cache_dir: Path) -> None:
        from fastembed import TextEmbedding

        LOGGER.info("loading embedding model %s", model_name)
        self._model = TextEmbedding(model_name=model_name, cache_dir=str(cache_dir))

    def embed(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        return [normalized_vector(vector) for vector in self._model.embed(list(texts))]


class RateLimiter:
    def __init__(self, limit: int = 45, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, client: str) -> bool:
        now = time.monotonic()
        threshold = now - self.window_seconds
        with self._lock:
            requests = self._requests[client]
            while requests and requests[0] < threshold:
                requests.popleft()
            if len(requests) >= self.limit:
                return False
            requests.append(now)
            if len(self._requests) > 2048:
                self._requests = defaultdict(
                    deque,
                    {key: values for key, values in self._requests.items() if values and values[-1] >= threshold},
                )
            return True


class SemanticSearchEngine:
    def __init__(
        self,
        index_dir: Path,
        database_path: Path,
        model_name: str,
        cache_dir: Path,
        embedder_factory: Callable[[str, Path], object] = FastEmbedModel,
    ) -> None:
        self.index_dir = index_dir
        self.database_path = database_path
        self.model_name = model_name
        self.cache_dir = cache_dir
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._embedder = embedder_factory(model_name, cache_dir)
        self._indexes: dict[str, LoadedIndex] = {}
        self._query_cache: OrderedDict[tuple[str, str, int, tuple[int, int]], list[dict]] = OrderedDict()
        self._lock = threading.RLock()
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        return connection

    def _initialize_database(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS embeddings (
                    model TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    dimension INTEGER NOT NULL,
                    vector BLOB NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (model, content_hash)
                )
                """
            )

    def _path(self, language: str) -> Path:
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError("unsupported language")
        return self.index_dir / f"index-{language}.json"

    def _signature(self, language: str) -> tuple[int, int]:
        stat = self._path(language).stat()
        return (stat.st_mtime_ns, stat.st_size)

    def _read_chunks(self, language: str) -> list[SearchChunk]:
        payload = json.loads(self._path(language).read_text(encoding="utf-8"))
        if payload.get("version") != 1 or payload.get("language") != language:
            raise ValueError(f"incompatible {language} index")
        chunks = []
        for chunk in payload.get("chunks", []):
            chain = " > ".join(str(part) for part in chunk.get("chain", []))
            embedding_text = "\n".join(
                part
                for part in (
                    chain,
                    str(chunk.get("title", "")),
                    str(chunk.get("heading", "")),
                    str(chunk.get("text", "")),
                )
                if part
            )
            chunks.append(
                SearchChunk(
                    id=str(chunk["id"]),
                    content_hash=str(chunk["content_hash"]),
                    embedding_text=embedding_text,
                )
            )
        return chunks

    def _cached_vectors(self, hashes: Sequence[str]) -> dict[str, tuple[float, ...]]:
        if not hashes:
            return {}
        cached: dict[str, tuple[float, ...]] = {}
        with self._connect() as connection:
            for offset in range(0, len(hashes), 400):
                batch = hashes[offset : offset + 400]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"SELECT content_hash, vector FROM embeddings "
                    f"WHERE model = ? AND content_hash IN ({placeholders})",
                    [self.model_name, *batch],
                )
                cached.update((content_hash, unpack_vector(vector)) for content_hash, vector in rows)
        return cached

    def _store_vectors(self, values: Sequence[tuple[str, Sequence[float]]]) -> None:
        if not values:
            return
        now = int(time.time())
        with self._connect() as connection:
            connection.executemany(
                """
                INSERT INTO embeddings(model, content_hash, dimension, vector, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(model, content_hash) DO UPDATE SET
                    dimension = excluded.dimension,
                    vector = excluded.vector,
                    updated_at = excluded.updated_at
                """,
                [
                    (self.model_name, content_hash, len(vector), pack_vector(vector), now)
                    for content_hash, vector in values
                ],
            )

    def ensure_loaded(self, language: str) -> LoadedIndex:
        signature = self._signature(language)
        current = self._indexes.get(language)
        if current and current.signature == signature:
            return current

        with self._lock:
            current = self._indexes.get(language)
            if current and current.signature == signature:
                return current

            chunks = self._read_chunks(language)
            cached = self._cached_vectors([chunk.content_hash for chunk in chunks])
            missing = [chunk for chunk in chunks if chunk.content_hash not in cached]
            if missing:
                LOGGER.info("embedding %d new or changed %s chunks", len(missing), language)
                for offset in range(0, len(missing), 32):
                    batch = missing[offset : offset + 32]
                    vectors = self._embedder.embed([chunk.embedding_text for chunk in batch])
                    if len(vectors) != len(batch):
                        raise RuntimeError("embedding model returned an incomplete batch")
                    stored = []
                    for chunk, vector in zip(batch, vectors):
                        normalized = normalized_vector(vector)
                        cached[chunk.content_hash] = normalized
                        stored.append((chunk.content_hash, normalized))
                    self._store_vectors(stored)

            loaded = LoadedIndex(
                signature=signature,
                chunks=tuple(chunks),
                vectors=tuple(cached[chunk.content_hash] for chunk in chunks),
            )
            self._indexes[language] = loaded
            self._query_cache.clear()
            LOGGER.info("loaded %s semantic index with %d chunks", language, len(chunks))
            return loaded

    def warm(self) -> None:
        for language in sorted(SUPPORTED_LANGUAGES):
            self.ensure_loaded(language)

    def search(self, query: str, language: str, limit: int) -> list[dict]:
        normalized_query = " ".join(query.split()).strip()
        if not normalized_query:
            raise ValueError("query is required")
        if len(normalized_query) > MAX_QUERY_CHARACTERS:
            raise ValueError("query is too long")
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError("unsupported language")
        limit = min(max(int(limit), 1), 50)

        index = self.ensure_loaded(language)
        cache_key = (language, normalized_query, limit, index.signature)
        with self._lock:
            if cache_key in self._query_cache:
                self._query_cache.move_to_end(cache_key)
                return self._query_cache[cache_key]
            query_vector = normalized_vector(self._embedder.embed([normalized_query])[0])
            ranked = sorted(
                (
                    (chunk.id, dot(query_vector, vector))
                    for chunk, vector in zip(index.chunks, index.vectors)
                ),
                key=lambda item: item[1],
                reverse=True,
            )[:limit]
            results = [{"id": chunk_id, "score": round(score, 6)} for chunk_id, score in ranked]
            self._query_cache[cache_key] = results
            while len(self._query_cache) > 256:
                self._query_cache.popitem(last=False)
            return results

    def health(self) -> dict:
        indexes = {}
        for language in sorted(SUPPORTED_LANGUAGES):
            loaded = self.ensure_loaded(language)
            indexes[language] = {"chunks": len(loaded.chunks)}
        return {"status": "ok", "model": self.model_name, "indexes": indexes}


class SearchHandler(BaseHTTPRequestHandler):
    server_version = "FunctionhxMagicSearch/1"

    @property
    def app(self) -> "SearchServer":
        return self.server  # type: ignore[return-value]

    def _origin(self) -> str:
        return self.headers.get("Origin", "")

    def _origin_allowed(self) -> bool:
        origin = self._origin()
        return not origin or origin in self.app.allowed_origins

    def _headers(self, status: int, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self._origin()
        if origin in self.app.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._headers(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _client_key(self) -> str:
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/search" or not self._origin_allowed():
            self._json(HTTPStatus.FORBIDDEN, {"error": "origin is not allowed"})
            return
        self._headers(HTTPStatus.NO_CONTENT, "text/plain; charset=utf-8")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/health":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if not self._origin_allowed():
            self._json(HTTPStatus.FORBIDDEN, {"error": "origin is not allowed"})
            return
        try:
            self._json(HTTPStatus.OK, self.app.engine.health())
        except Exception:
            LOGGER.exception("health check failed")
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"status": "unavailable"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/search":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if not self._origin_allowed():
            self._json(HTTPStatus.FORBIDDEN, {"error": "origin is not allowed"})
            return
        if not self.app.rate_limiter.allow(self._client_key()):
            self._json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "rate limit exceeded"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid request size"})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            query = str(payload.get("query", ""))
            language = str(payload.get("language", "zh"))
            limit = int(payload.get("limit", 20))
            started = time.monotonic()
            results = self.app.engine.search(query, language, limit)
            self._json(
                HTTPStatus.OK,
                {
                    "version": 1,
                    "language": language,
                    "elapsed_ms": round((time.monotonic() - started) * 1000, 1),
                    "results": results,
                },
            )
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception:
            LOGGER.exception("semantic search failed")
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "semantic search unavailable"})

    def log_message(self, format_string: str, *args: object) -> None:
        LOGGER.info("%s %s", self.address_string(), format_string % args)


class SearchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        engine: SemanticSearchEngine,
        allowed_origins: set[str],
    ) -> None:
        super().__init__(address, SearchHandler)
        self.engine = engine
        self.allowed_origins = allowed_origins
        self.rate_limiter = RateLimiter()


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("MAGIC_SEARCH_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    index_dir = Path(os.environ.get("MAGIC_SEARCH_INDEX_DIR", "/var/www/functionhx/current/assets/search"))
    database_path = Path(
        os.environ.get("MAGIC_SEARCH_DB", "/var/lib/functionhx-magic-search/embeddings.sqlite3")
    )
    cache_dir = Path(os.environ.get("MAGIC_SEARCH_MODEL_CACHE", "/var/cache/functionhx-magic-search"))
    model_name = os.environ.get("MAGIC_SEARCH_MODEL", DEFAULT_MODEL)
    host = os.environ.get("MAGIC_SEARCH_HOST", "127.0.0.1")
    port = int(os.environ.get("MAGIC_SEARCH_PORT", "8790"))
    allowed_origins = {
        origin.strip()
        for origin in os.environ.get(
            "MAGIC_SEARCH_ALLOWED_ORIGINS",
            "https://functionhx.github.io,https://fanyuchen.com.cn,https://www.fanyuchen.com.cn,http://localhost:4000",
        ).split(",")
        if origin.strip()
    }

    engine = SemanticSearchEngine(index_dir, database_path, model_name, cache_dir)
    engine.warm()
    server = SearchServer((host, port), engine, allowed_origins)
    LOGGER.info("serving semantic retrieval on http://%s:%d", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
