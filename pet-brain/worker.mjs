// Pet Brain：网站宠物们的「大脑」，跑在 Cloudflare Worker 上。
//
// 浏览器里的宠物只在访客主动提问时才调用这里；感知、记忆、动作都在浏览器本地完成。
// 这里做五件事：保管各家模型的密钥；按宠物选模型（自家模型没配好时由 DeepSeek 代班）；
// 限流与每日 token 预算；从站内内容里检索资料拼进提示词，让回答有出处；把回答以 SSE 流式转给浏览器。
//
// 隐私：不记录、不存储任何对话内容，只在 KV 里记次数与 token 用量。
// 安全：问到首页那封信时不调用模型；密钥只在 Worker 密钥里；只接受站点来源的请求。

import { DEFAULT_PET, LETTER_REPLY, PETS, systemPersona } from "./persona.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 600;
const MAX_PAGE_CHARS = 1200;
const MATERIAL_CHUNKS = 3;
const CHUNK_CHARS = 900;
const CORPUS_TTL_MS = 10 * 60 * 1000;
const LETTER_PATTERN = /(信封|那封信|一封信|暗号|口令|拆信|六位|pin\b|信的密码|信件)/i;

// 各家模型。密钥（*_API_KEY）只用 wrangler secret 设置；模型名在 wrangler.toml 的 [vars] 里，
// 没有密钥或没有模型名的那家视为没接上。OpenAI 与 Gemini 走 OpenAI 兼容接口，Anthropic 走 Messages API。
export const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    keyVar: "DEEPSEEK_API_KEY",
    modelVar: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-flash",
    baseVar: "DEEPSEEK_BASE_URL",
    defaultBase: "https://api.deepseek.com",
    format: "openai",
  },
  anthropic: {
    label: "Anthropic",
    keyVar: "ANTHROPIC_API_KEY",
    modelVar: "ANTHROPIC_MODEL",
    defaultModel: "",
    baseVar: "ANTHROPIC_BASE_URL",
    defaultBase: "https://api.anthropic.com",
    format: "anthropic",
  },
  openai: {
    label: "OpenAI",
    keyVar: "OPENAI_API_KEY",
    modelVar: "OPENAI_MODEL",
    defaultModel: "",
    baseVar: "OPENAI_BASE_URL",
    defaultBase: "https://api.openai.com/v1",
    format: "openai",
    // 新模型不接受 max_tokens / temperature。
    modern: true,
  },
  gemini: {
    label: "Google",
    keyVar: "GEMINI_API_KEY",
    modelVar: "GEMINI_MODEL",
    defaultModel: "",
    baseVar: "GEMINI_BASE_URL",
    defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    format: "openai",
  },
};
const STAND_IN = "deepseek";

export function providerConfig(env, id) {
  const spec = PROVIDERS[id];
  if (!spec) return null;
  const key = env[spec.keyVar];
  const model = env[spec.modelVar] || spec.defaultModel;
  if (!key || !model) return null;
  return { id, ...spec, key, model, base: String(env[spec.baseVar] || spec.defaultBase).replace(/\/$/, "") };
}

// 这只宠物这次该由谁回答：自家模型优先（接上了、当天额度没用完），否则 DeepSeek 代班。
export async function routesFor(env, petId, day) {
  const home = (PETS[petId] || PETS[DEFAULT_PET]).home;
  const routes = [];
  const own = providerConfig(env, home);
  if (own && (day === null || (await underProviderBudget(env, day, home)))) routes.push({ ...own, standIn: false });
  if (home !== STAND_IN) {
    const standIn = providerConfig(env, STAND_IN);
    if (standIn) routes.push({ ...standIn, standIn: true });
  }
  return routes;
}

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

// 全站总预算 DAILY_TOKEN_BUDGET 之外，每家还可以单独设 <家>_DAILY_TOKEN_BUDGET（如 ANTHROPIC_DAILY_TOKEN_BUDGET）：
// 用完后这家当天不再调用，由 DeepSeek 代班。
const providerBudget = (env, id) => Number(env[`${id.toUpperCase()}_DAILY_TOKEN_BUDGET`] || 0);

async function underProviderBudget(env, day, id) {
  const limit = providerBudget(env, id);
  return !limit || (await counter(env, `tokens:${day}:${id}`)) < limit;
}

export async function recordTokens(env, day, tokens, provider = STAND_IN) {
  if (!tokens) return;
  for (const key of [`tokens:${day}`, `tokens:${day}:${provider}`]) {
    await env.PET_LIMITS.put(key, String((await counter(env, key)) + tokens), { expirationTtl: 60 * 60 * 30 });
  }
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
    pet: Object.hasOwn(PETS, body.pet) ? body.pet : DEFAULT_PET,
  };
}

// ------------------------------------------------------------------ 站内资料检索

let corpusCache = { at: 0, url: "", chunks: [] };

// llms-full.txt：开头是站长简介（「# 名字」与「> 一句话」），之后每个条目以「## 标题」开头、下一段是「原文：网址」。
// 正文里也有自己的「## 小节」标题，它们不带「原文」，属于当前条目。长条目切成若干块，每块都带条目标题与网址。
export function chunkCorpus(text, siteUrl = "") {
  const lines = String(text).split("\n");
  const items = [];
  const intro = { title: "关于站长", url: siteUrl ? `${siteUrl.replace(/\/$/, "")}/` : "", body: [] };
  let current = intro;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("## ")) {
      let next = index + 1;
      while (next < lines.length && !lines[next].trim()) next += 1;
      const source = (lines[next] || "").match(/^原文：(\S+)/);
      if (source) {
        current = { title: line.slice(3).trim(), url: source[1], body: [] };
        items.push(current);
        index = next;
        continue;
      }
    } else if (/^# /.test(line)) {
      // 第一行是站名；之后的「# 文章」「# 项目与研究」这类分组标题不属于任何条目。
      if (index === 0) intro.body.push(line.slice(2));
      else current = null;
      continue;
    }
    if (current) current.body.push(line);
  }
  const chunks = [];
  for (const item of [intro, ...items]) {
    const body = item.body
      .join("\n")
      .replace(/^全部公开文章.*$/m, "")
      .trim();
    if (!body) continue;
    for (let start = 0; start < body.length; start += CHUNK_CHARS) {
      chunks.push({ title: item.title, url: item.url, text: body.slice(start, start + CHUNK_CHARS) });
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

// 到处都有的两字组合：命中它们不说明问题和这段资料有关。
const COMMON_TERMS = new Set(
  "什么 为什 怎么 怎样 如何 一个 一下 这个 那个 这里 那里 知道 可以 能不 我们 你们 他们 不是 就是 还是 没有 是不 有没 你好 谢谢 吗？ 的是 了吗 是谁 你是 我是 网站 本站".split(
    " "
  )
);

// 只有问题本身命中了这段资料，它才算相关；当前页面和小节只用来在相关的资料里排先后。
export function retrieve(chunks, query, page, limit = MATERIAL_CHUNKS) {
  const wanted = [...new Set(terms(query))].filter((term) => !COMMON_TERMS.has(term));
  const context = terms(`${page.title} ${page.section}`);
  const aboutOwner = /站长|樊宇琛|你主人|他是谁|介绍一下/.test(query);
  const scored = chunks.map((chunk) => {
    const haystack = `${chunk.title}\n${chunk.text}`.toLowerCase();
    const title = chunk.title.toLowerCase();
    let relevance = 0;
    for (const term of wanted) {
      if (haystack.includes(term)) relevance += 2;
      if (title.includes(term)) relevance += 3;
    }
    if (chunk.title === "关于站长" && aboutOwner) relevance += 6;
    const samePage = Boolean(page.url && chunk.url && page.url.split("#")[0] === chunk.url);
    // 「这里讲的是什么」一类问题：当前页面本身就是相关资料。
    if (samePage && /这里|这页|这篇|本文|这段|这张|这个项目/.test(query)) relevance += 4;
    let score = relevance;
    for (const term of context) if (haystack.includes(term)) score += 0.5;
    if (samePage) score += 4;
    return { chunk, relevance, score };
  });
  return scored
    .filter((item) => item.relevance >= 4)
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
    corpusCache = { at: Date.now(), url, chunks: chunkCorpus(await response.text(), env.SITE_URL || "https://functionhx.github.io") };
  } catch (error) {
    console.error("pet-brain: corpus unavailable", error?.message || "unknown");
  }
  return corpusCache.chunks;
}

export function buildPrompt({ messages, page, petName, pet = DEFAULT_PET }, materials, route = { label: PROVIDERS[STAND_IN].label, standIn: false }) {
  const material = materials.length
    ? materials.map((m, index) => `[${index + 1}] 《${m.title}》 原文：${m.url}\n${m.text}`).join("\n\n")
    : "（没有检索到相关资料）";
  const pageBlock =
    page.title || page.excerpt ? `标题：${page.title}\n网址：${page.url}\n正在看的小节：${page.section}\n内容摘录：${page.excerpt}` : "（未知）";
  const nickname = petName ? `\n访客给你起的小名是「${petName}」，可以用它自称。` : "";
  return {
    system: `${systemPersona(pet, route)}${nickname}\n\n<资料>\n${material}\n</资料>\n\n<页面>\n${pageBlock}\n</页面>`,
    messages,
  };
}

// 按各家的接口格式组装请求。
export function upstreamRequest(route, prompt, maxTokens) {
  if (route.format === "anthropic") {
    // Messages API 要求对话以访客开头。
    const messages = prompt.messages.slice(prompt.messages.findIndex((m) => m.role === "user"));
    return {
      url: `${route.base}/v1/messages`,
      init: {
        method: "POST",
        headers: { "x-api-key": route.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: route.model, system: prompt.system, messages, max_tokens: maxTokens, stream: true }),
      },
    };
  }
  const limits = route.modern ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens, temperature: 0.8 };
  return {
    url: `${route.base}/chat/completions`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${route.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: route.model,
        messages: [{ role: "system", content: prompt.system }, ...prompt.messages],
        stream: true,
        stream_options: { include_usage: true },
        ...limits,
      }),
    },
  };
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

// 从一条上游事件里取出文字与用量。OpenAI 兼容格式给 total_tokens；Anthropic 分别在开头给输入、结尾给输出。
function readEvent(format, chunk, usage) {
  if (format === "anthropic") {
    if (chunk?.type === "message_start") usage.input = Number(chunk.message?.usage?.input_tokens || 0);
    if (chunk?.type === "message_delta") usage.output = Number(chunk.usage?.output_tokens || 0);
    return chunk?.type === "content_block_delta" && chunk.delta?.type === "text_delta" ? chunk.delta.text : "";
  }
  if (chunk?.usage?.total_tokens) usage.total = chunk.usage.total_tokens;
  return chunk?.choices?.[0]?.delta?.content || "";
}

// 模型在回答最后写「【引用：1,3】」或「【引用：无】」，说明它实际用到了哪几条资料。
// 这个标记不给访客看：边转发边把它拦下来（可能被拆在几个片段里），出处只列它真正引用的那几条。
const CITATION = /\s*【引用[：:]\s*([^】]*)】/;
export function citationFilter() {
  let pending = "";
  let cited = null;
  const mayBecomeMarker = (tail) => tail.startsWith("【引用") || "【引用".startsWith(tail);
  return {
    push(text) {
      pending += text;
      let out = "";
      for (;;) {
        const match = pending.match(CITATION);
        if (match) {
          cited = (match[1].match(/\d+/g) || []).map(Number);
          out += pending.slice(0, match.index);
          pending = pending.slice(match.index + match[0].length);
          continue;
        }
        const open = pending.lastIndexOf("【");
        if (open !== -1 && mayBecomeMarker(pending.slice(open))) {
          out += pending.slice(0, open);
          pending = pending.slice(open);
        } else {
          out += pending;
          pending = "";
        }
        break;
      }
      // 结尾的空白先留着：如果后面紧跟引用标记，它们一起去掉。
      const trailing = out.match(/\s+$/);
      if (trailing) {
        pending = trailing[0] + pending;
        out = out.slice(0, -trailing[0].length);
      }
      return out;
    },
    flush() {
      const rest = pending.trimEnd();
      pending = "";
      return /^\s*【引用/.test(rest) ? "" : rest;
    },
    cited: () => cited,
  };
}

export function citedSources(materials, cited) {
  const sources = [];
  for (const index of cited || []) {
    const material = materials[index - 1];
    if (material && material.url && !sources.some((s) => s.url === material.url)) sources.push({ title: material.title, url: material.url });
  }
  return sources;
}

// 把上游的流转换成 {t} 片段；结束时附上实际引用的出处和「这次是谁回答的」，并把 token 用量记进预算。
export function relay(upstream, { materials = [], onUsage, format = "openai", model = "", standIn = false }) {
  const decoder = new TextDecoder();
  const citations = citationFilter();
  let buffer = "";
  const usage = { total: 0, input: 0, output: 0 };
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
            const text = citations.push(readEvent(format, chunk, usage));
            if (text) controller.enqueue(sse({ t: text }));
          }
        }
        const rest = citations.flush();
        if (rest) controller.enqueue(sse({ t: rest }));
        controller.enqueue(sse({ done: true, sources: citedSources(materials, citations.cited()), model, standIn }));
      } catch (error) {
        console.error("pet-brain: stream interrupted", error?.message || "unknown");
        controller.enqueue(sse({ error: "stream_interrupted" }));
      } finally {
        controller.close();
        await onUsage(usage.total || usage.input + usage.output).catch(() => undefined);
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
  // 每只宠物现在由谁回答（不含额度），浏览器用它在面板里如实告诉访客对话会发给谁。
  if (url.pathname === "/health") {
    const pets = {};
    for (const id of Object.keys(PETS)) {
      const [route] = await routesFor(env, id, null);
      pets[id] = route ? { model: route.label, standIn: route.standIn } : null;
    }
    return json(200, { ok: true, pets }, origin);
  }
  if (url.pathname !== "/chat") return json(404, { error: "not_found" }, origin);

  try {
    if (request.method !== "POST") throw new HttpError(405, "Use POST.", "method_not_allowed");
    if (!origin) throw new HttpError(403, "This origin is not allowed.", "origin_denied");
    if (!env.PET_LIMITS) throw new HttpError(503, "Rate limiting is not configured.", "limits_missing");

    const chat = await readChat(request);
    const question = chat.messages[chat.messages.length - 1].content;
    // 信：不调用模型，也不计入次数。
    if (LETTER_PATTERN.test(question)) return oneShot(LETTER_REPLY, origin, { letter: true });

    const ip = clientAddress(request);
    const { day, hour } = stamp(now);
    const routes = await routesFor(env, chat.pet, day);
    if (!routes.length) throw new HttpError(503, "The pet brain is not configured yet.", "not_configured");
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

    // 自家模型出错时换 DeepSeek 代班再试一次。
    for (const route of routes) {
      const { url: target, init } = upstreamRequest(route, buildPrompt(chat, materials, route), Number(env.MAX_OUTPUT_TOKENS || 400));
      let upstream;
      try {
        upstream = await fetcher(target, init);
      } catch (error) {
        console.error("pet-brain: upstream unreachable", route.id, error?.message || "unknown");
        continue;
      }
      if (!upstream.ok || !upstream.body) {
        console.error("pet-brain: upstream error", route.id, upstream.status);
        continue;
      }
      return sseResponse(
        relay(upstream, {
          materials,
          format: route.format,
          model: route.label,
          standIn: route.standIn,
          // 流结束后 Worker 可能被回收，用量写入交给 waitUntil 等它完成。
          onUsage: async (tokens) => waitUntil(recordTokens(env, day, tokens, route.id)),
        }),
        origin
      );
    }
    throw new HttpError(502, "The model is unavailable right now.", "upstream_error");
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
