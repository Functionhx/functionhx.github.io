// Pet Brain：网站宠物 ƒ-01 的「大脑」，跑在 Cloudflare Worker 上。
//
// 浏览器里的宠物只在访客主动提问时才调用这里；感知、记忆、动作都在浏览器本地完成。
// 这里做四件事：保管 DeepSeek 密钥；限流与每日 token 预算；从站内内容里检索资料拼进提示词，
// 让回答有出处；把模型的回答以 SSE 流式转给浏览器。
//
// 隐私：不记录、不存储任何对话内容，只在 KV 里记次数与 token 用量。
// 安全：问到首页那封信时不调用模型；密钥只在 Worker 密钥里；只接受站点来源的请求。

import { LETTER_REPLY, PERSONA } from "./persona.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 600;
const MAX_PAGE_CHARS = 1200;
const MATERIAL_CHUNKS = 3;
const CHUNK_CHARS = 900;
const CORPUS_TTL_MS = 10 * 60 * 1000;
const LETTER_PATTERN = /(信封|那封信|一封信|暗号|口令|拆信|六位|pin\b|信的密码|信件)/i;

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function siteOrigins(env) {
  return String(env.SITE_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return siteOrigins(env).includes(origin) ? origin : "";
}

function corsHeaders(origin) {
  return origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(origin),
    },
  });
}

function clientAddress(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

function stamp(date = new Date()) {
  const iso = date.toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(0, 13) };
}

// ------------------------------------------------------------------ 限流与预算（KV，最终一致，是「大致」上限）

async function counter(env, key) {
  return Number((await env.PET_LIMITS.get(key)) || 0);
}

async function consume(env, key, limit, ttl) {
  const current = await counter(env, key);
  if (current >= limit) return false;
  await env.PET_LIMITS.put(key, String(current + 1), { expirationTtl: ttl });
  return true;
}

export async function recordTokens(env, day, tokens) {
  if (!tokens) return;
  const key = `tokens:${day}`;
  await env.PET_LIMITS.put(key, String((await counter(env, key)) + tokens), { expirationTtl: 60 * 60 * 30 });
}

// ------------------------------------------------------------------ 请求校验

function clean(value, limit) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, limit);
}

export async function readChat(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Send JSON.", "unsupported_media_type");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large.", "too_large");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.", "invalid_json");
  }
  const messages = (Array.isArray(body?.messages) ? body.messages : [])
    .slice(-MAX_MESSAGES)
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: clean(m.content, MAX_MESSAGE_CHARS) }))
    .filter((m) => m.content);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    throw new HttpError(400, "The last message must come from the visitor.", "invalid_messages");
  }
  const page = body.page && typeof body.page === "object" ? body.page : {};
  return {
    messages,
    page: {
      url: clean(page.url, 300),
      title: clean(page.title, 200),
      section: clean(page.section, 200),
      excerpt: clean(page.excerpt, MAX_PAGE_CHARS),
    },
    petName: clean(body.petName, 24),
  };
}

// ------------------------------------------------------------------ 站内资料检索

let corpusCache = { at: 0, url: "", chunks: [] };

// llms-full.txt 的每个条目以「## 标题」开头，下一段是「原文：网址」。长条目切成若干块，每块都带标题与网址。
export function chunkCorpus(text) {
  const chunks = [];
  for (const section of String(text).split(/^## /m).slice(1)) {
    const lines = section.split("\n");
    const title = lines[0].trim();
    const source = (section.match(/^原文：(\S+)/m) || [])[1] || "";
    const body = lines
      .slice(1)
      .join("\n")
      .replace(/^原文：\S+\s*$/m, "")
      .trim();
    for (let start = 0; start < Math.max(body.length, 1); start += CHUNK_CHARS) {
      chunks.push({ title, url: source, text: body.slice(start, start + CHUNK_CHARS) });
    }
  }
  return chunks;
}

// 中文按相邻两字切分，英文与数字按词切分。
export function terms(text) {
  const lower = String(text || "").toLowerCase();
  const out = [];
  for (const word of lower.match(/[a-z0-9][a-z0-9.+\-]{1,}/g) || []) out.push(word);
  for (const run of lower.match(/[㐀-鿿]+/g) || []) {
    if (run.length === 1) out.push(run);
    for (let index = 0; index + 1 < run.length; index += 1) out.push(run.slice(index, index + 2));
  }
  return out;
}

export function retrieve(chunks, query, page, limit = MATERIAL_CHUNKS) {
  const wanted = terms(query);
  const context = terms(`${page.title} ${page.section}`);
  const scored = chunks.map((chunk) => {
    const haystack = `${chunk.title}\n${chunk.text}`.toLowerCase();
    const title = chunk.title.toLowerCase();
    let score = 0;
    for (const term of wanted) {
      if (haystack.includes(term)) score += 2;
      if (title.includes(term)) score += 3;
    }
    for (const term of context) if (haystack.includes(term)) score += 0.5;
    if (page.url && chunk.url && page.url.split("#")[0] === chunk.url) score += 4;
    return { chunk, score };
  });
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.chunk);
}

async function loadCorpus(env, fetcher) {
  const url = `${String(env.SITE_URL || "https://functionhx.github.io").replace(/\/$/, "")}/llms-full.txt`;
  if (corpusCache.url === url && Date.now() - corpusCache.at < CORPUS_TTL_MS) return corpusCache.chunks;
  try {
    const response = await fetcher(url, { cf: { cacheTtl: 600 } });
    if (!response.ok) throw new Error(String(response.status));
    corpusCache = { at: Date.now(), url, chunks: chunkCorpus(await response.text()) };
  } catch (error) {
    console.error("pet-brain: corpus unavailable", error?.message || "unknown");
  }
  return corpusCache.chunks;
}

export function buildPrompt({ messages, page, petName }, materials) {
  const material = materials.length
    ? materials.map((m, index) => `[${index + 1}] 《${m.title}》 原文：${m.url}\n${m.text}`).join("\n\n")
    : "（没有检索到相关资料）";
  const pageBlock =
    page.title || page.excerpt ? `标题：${page.title}\n网址：${page.url}\n正在看的小节：${page.section}\n内容摘录：${page.excerpt}` : "（未知）";
  const nickname = petName ? `\n访客给你起的小名是「${petName}」，可以用它自称。` : "";
  return [{ role: "system", content: `${PERSONA}${nickname}\n\n<资料>\n${material}\n</资料>\n\n<页面>\n${pageBlock}\n</页面>` }, ...messages];
}

// ------------------------------------------------------------------ SSE

const encoder = new TextEncoder();
const sse = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

function sseResponse(stream, origin) {
  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(origin),
    },
  });
}

function oneShot(text, origin, extra = {}) {
  return sseResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(sse({ t: text }));
        controller.enqueue(sse({ done: true, sources: [], ...extra }));
        controller.close();
      },
    }),
    origin
  );
}

// 把 DeepSeek 的 OpenAI 格式流转换成 {t} 片段；结束时附上出处，并把 token 用量记进预算。
export function relay(upstream, { sources, onUsage }) {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = 0;
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n");
          buffer = events.pop() || "";
          for (const line of events) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let chunk;
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }
            const text = chunk?.choices?.[0]?.delta?.content;
            if (text) controller.enqueue(sse({ t: text }));
            if (chunk?.usage?.total_tokens) usage = chunk.usage.total_tokens;
          }
        }
        controller.enqueue(sse({ done: true, sources }));
      } catch (error) {
        console.error("pet-brain: stream interrupted", error?.message || "unknown");
        controller.enqueue(sse({ error: "stream_interrupted" }));
      } finally {
        controller.close();
        await onUsage(usage).catch(() => undefined);
      }
    },
  });
}

// ------------------------------------------------------------------ 入口

export async function handleRequest(request, env, { fetch: fetcher = fetch, waitUntil = () => undefined, now = new Date() } = {}) {
  const origin = allowedOrigin(request, env);
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    if (!origin) return json(403, { error: "origin_denied" });
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      },
    });
  }
  if (url.pathname === "/health") return json(200, { ok: true }, origin);
  if (url.pathname !== "/chat") return json(404, { error: "not_found" }, origin);

  try {
    if (request.method !== "POST") throw new HttpError(405, "Use POST.", "method_not_allowed");
    if (!origin) throw new HttpError(403, "This origin is not allowed.", "origin_denied");
    if (!env.DEEPSEEK_API_KEY) throw new HttpError(503, "The pet brain is not configured yet.", "not_configured");
    if (!env.PET_LIMITS) throw new HttpError(503, "Rate limiting is not configured.", "limits_missing");

    const chat = await readChat(request);
    const question = chat.messages[chat.messages.length - 1].content;
    // 信：不调用模型，也不计入次数。
    if (LETTER_PATTERN.test(question)) return oneShot(LETTER_REPLY, origin, { letter: true });

    const ip = clientAddress(request);
    const { day, hour } = stamp(now);
    const budget = Number(env.DAILY_TOKEN_BUDGET || 100_000_000);
    if ((await counter(env, `tokens:${day}`)) >= budget) throw new HttpError(429, "Daily budget used up.", "budget_exhausted");
    if (!(await consume(env, `ip:${hour}:${ip}`, Number(env.PER_IP_HOURLY_LIMIT || 30), 60 * 60 * 2))) {
      throw new HttpError(429, "Too many messages this hour.", "rate_limited");
    }
    if (!(await consume(env, `ipday:${day}:${ip}`, Number(env.PER_IP_DAILY_LIMIT || 150), 60 * 60 * 26))) {
      throw new HttpError(429, "Too many messages today.", "rate_limited");
    }

    const chunks = await loadCorpus(env, fetcher);
    const materials = retrieve(chunks, question, chat.page);
    const sources = [];
    for (const m of materials) if (m.url && !sources.some((s) => s.url === m.url)) sources.push({ title: m.title, url: m.url });

    const upstream = await fetcher(`${String(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || "deepseek-flash",
        messages: buildPrompt(chat, materials),
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: Number(env.MAX_OUTPUT_TOKENS || 400),
        temperature: 0.8,
      }),
    });
    if (!upstream.ok || !upstream.body) {
      console.error("pet-brain: upstream error", upstream.status);
      throw new HttpError(502, "The model is unavailable right now.", "upstream_error");
    }
    return sseResponse(
      relay(upstream, {
        sources,
        // 流结束后 Worker 可能被回收，用量写入交给 waitUntil 等它完成。
        onUsage: async (tokens) => waitUntil(recordTokens(env, day, tokens)),
      }),
      origin
    );
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.code }, origin);
    console.error("pet-brain: unexpected error", error?.message || "unknown");
    return json(500, { error: "internal_error" }, origin);
  }
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, { waitUntil: (promise) => ctx.waitUntil(promise) });
  },
};
