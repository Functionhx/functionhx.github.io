import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import worker from "./worker.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

class RequestTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestTooLargeError";
    this.status = 413;
  }
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function appendRequestHeaders(target, source) {
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) target.append(name, item);
    } else if (value !== undefined) {
      target.set(name, value);
    }
  }
}

async function readRequestBody(request, maximum) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximum) throw new RequestTooLargeError();
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks, length) : undefined;
}

function requestBase(request, env, host, port) {
  const configured = String(env.WORKER_ORIGIN || "").trim();
  if (configured) return new URL(configured).origin;
  const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  const authority = request.headers.host || `${host}:${port}`;
  return `${protocol}://${authority}`;
}

async function toWebRequest(request, env, host, port, maximumBodyBytes) {
  const method = String(request.method || "GET").toUpperCase();
  const headers = new Headers();
  appendRequestHeaders(headers, request.headers);
  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request, maximumBodyBytes);
  return new Request(new URL(request.url || "/", requestBase(request, env, host, port)), {
    body,
    headers,
    method,
  });
}

async function sendWebResponse(response, nodeResponse, headOnly = false) {
  nodeResponse.statusCode = response.status;
  for (const [name, value] of response.headers) nodeResponse.setHeader(name, value);
  if (headOnly || !response.body) {
    nodeResponse.end();
    return;
  }
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

function sendAdapterError(error, response) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("Spark Vault Node adapter failed", error);
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      error: {
        code: status === 413 ? "request_too_large" : "adapter_error",
        message: status === 413 ? "Request body is too large." : "Spark Vault could not process this request.",
      },
    })
  );
}

export function createSparkVaultServer(options = {}) {
  const env = options.env || process.env;
  const host = String(options.host || env.HOST || DEFAULT_HOST);
  const port = positiveInteger(options.port ?? env.PORT, DEFAULT_PORT, "PORT");
  const maximumBodyBytes = positiveInteger(options.maximumBodyBytes ?? env.MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES, "MAX_BODY_BYTES");
  const fetchHandler = options.fetchHandler || worker.fetch.bind(worker);

  const server = createServer(async (request, response) => {
    try {
      const webRequest = await toWebRequest(request, env, host, port, maximumBodyBytes);
      const webResponse = await fetchHandler(webRequest, env);
      await sendWebResponse(webResponse, response, request.method === "HEAD");
    } catch (error) {
      sendAdapterError(error, response);
    }
  });

  return { host, port, server };
}

function isDirectInvocation() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectInvocation()) {
  const { host, port, server } = createSparkVaultServer();
  server.listen(port, host, () => {
    console.log(`Functionhx Spark Vault listening on http://${host}:${port}`);
  });

  function close(signal) {
    console.log(`Functionhx Spark Vault received ${signal}; shutting down.`);
    server.close((error) => {
      if (error) {
        console.error("Functionhx Spark Vault shutdown failed", error);
        process.exitCode = 1;
      }
    });
  }

  process.once("SIGINT", () => close("SIGINT"));
  process.once("SIGTERM", () => close("SIGTERM"));
}
