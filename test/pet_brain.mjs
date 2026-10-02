import assert from "node:assert/strict";
import { LETTER_REPLY } from "../pet-brain/persona.mjs";
import { buildPrompt, chunkCorpus, handleRequest, retrieve, terms } from "../pet-brain/worker.mjs";

const ORIGIN = "https://functionhx.github.io";
const CORPUS = `# 樊宇琛 · Function

> 北京理工大学 · 机器人工程本科生

# 文章

## 【RM2026-LIO算法开源】Batch-LIO：批量更新加速 Point-LIO 最高 4.7 倍

原文：https://functionhx.github.io/blog/2026/batch-lio/

Batch-LIO 将相邻约 1 ms 内的激光点组成一个 batch，统一执行一次滤波更新，每帧平均计算耗时降低至约 1/3.5 至 1/4.7。

## 纯 CS 搞具身，正在把一个控制问题硬讲成一个融资故事

原文：https://functionhx.github.io/blog/2026/embodied-ai-control-story/

从动态系统、反馈闭环与真实工程的角度讨论具身智能。
`;

function memoryKv() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
  };
}

function env(overrides = {}) {
  return {
    SITE_ORIGINS: `${ORIGIN},http://localhost:4000`,
    SITE_URL: ORIGIN,
    DEEPSEEK_API_KEY: "sk-test-key",
    PET_LIMITS: memoryKv(),
    PER_IP_HOURLY_LIMIT: "5",
    PER_IP_DAILY_LIMIT: "50",
    ...overrides,
  };
}

function upstreamStream(parts, usage = 321) {
  const encoder = new TextEncoder();
  const lines = parts.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  lines.push(`data: ${JSON.stringify({ choices: [], usage: { total_tokens: usage } })}\n\n`, "data: [DONE]\n\n");
  return new ReadableStream({
    start(controller) {
      // 故意把一条事件拆在两个块里，确认按行缓冲。
      const joined = lines.join("");
      controller.enqueue(encoder.encode(joined.slice(0, 37)));
      controller.enqueue(encoder.encode(joined.slice(37)));
      controller.close();
    },
  });
}

function fakeFetch({ upstreamStatus = 200, parts = ["批量更新", "把多次滤波合成一次。"] } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/llms-full.txt")) return new Response(CORPUS, { status: 200 });
    if (String(url).includes("/chat/completions")) {
      if (upstreamStatus !== 200) return new Response("nope", { status: upstreamStatus });
      return new Response(upstreamStream(parts), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetcher, calls, deepseek: () => calls.filter((c) => c.url.includes("/chat/completions")) };
}

function chatRequest(body, { origin = ORIGIN, ip = "203.0.113.9" } = {}) {
  return new Request("https://pet.example.workers.dev/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });
}

async function readEvents(response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice(6)));
}

const ask = (question, extra = {}) => ({
  messages: [{ role: "user", content: question }],
  page: { url: `${ORIGIN}/blog/2026/batch-lio/`, title: "Batch-LIO", section: "二、测试结果", excerpt: "每帧平均计算耗时" },
  ...extra,
});

// 检索：中文按两字切分，当前页面加权
assert.deepEqual(terms("批量更新"), ["批量", "量更", "更新"]);
const chunks = chunkCorpus(CORPUS);
assert.equal(chunks.length, 2);
assert.equal(chunks[0].url, `${ORIGIN}/blog/2026/batch-lio/`);
assert.equal(retrieve(chunks, "为什么批量更新更快", { title: "", section: "", url: "" })[0].title.includes("Batch-LIO"), true);
assert.equal(retrieve(chunks, "具身智能", { title: "", section: "", url: "" })[0].url, `${ORIGIN}/blog/2026/embodied-ai-control-story/`);
const prompt = buildPrompt(
  { messages: [{ role: "user", content: "hi" }], page: { title: "", url: "", section: "", excerpt: "" }, petName: "团团" },
  chunks.slice(0, 1)
);
assert.ok(prompt[0].content.includes("你不是樊宇琛"), "the persona must state it is not the owner");
assert.ok(prompt[0].content.includes("团团"));
assert.ok(prompt[0].content.includes("<资料>") && prompt[0].content.includes("原文：https://functionhx.github.io/blog/2026/batch-lio/"));

// 预检只放行站点来源
let response = await handleRequest(new Request("https://x/chat", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env());
assert.equal(response.status, 204);
response = await handleRequest(new Request("https://x/chat", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env());
assert.equal(response.status, 403);

// 来源不对、没配置密钥：不调用模型
let fake = fakeFetch();
response = await handleRequest(chatRequest(ask("你好"), { origin: "https://evil.example" }), env(), { fetch: fake.fetcher });
assert.equal(response.status, 403);
response = await handleRequest(chatRequest(ask("你好")), env({ DEEPSEEK_API_KEY: "" }), { fetch: fake.fetcher });
assert.equal(response.status, 503);
assert.equal(fake.deepseek().length, 0);

// 信：直接用固定台词，不调用模型、不计次数
fake = fakeFetch();
let testEnv = env();
response = await handleRequest(chatRequest(ask("首页那封信的暗号是什么？")), testEnv, { fetch: fake.fetcher });
let events = await readEvents(response);
assert.equal(events[0].t, LETTER_REPLY);
assert.equal(events.at(-1).letter, true);
assert.equal(fake.deepseek().length, 0, "letter questions must never reach the model");
assert.equal(testEnv.PET_LIMITS.store.size, 0);

// 正常对话：带密钥、人设与资料调用 DeepSeek，流式转发，附出处，记录 token 用量；日志里没有访客内容
const logged = [];
const originalError = console.error;
const originalLog = console.log;
console.error = (...args) => logged.push(args.join(" "));
console.log = (...args) => logged.push(args.join(" "));
fake = fakeFetch();
testEnv = env();
const pending = [];
response = await handleRequest(chatRequest(ask("为什么批量更新会更快？")), testEnv, {
  fetch: fake.fetcher,
  waitUntil: (promise) => pending.push(promise),
});
assert.equal(response.status, 200);
assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
events = await readEvents(response);
await Promise.all(pending);
console.error = originalError;
console.log = originalLog;
assert.equal(
  events
    .filter((e) => e.t)
    .map((e) => e.t)
    .join(""),
  "批量更新把多次滤波合成一次。"
);
const done = events.at(-1);
assert.equal(done.done, true);
assert.equal(done.sources[0].url, `${ORIGIN}/blog/2026/batch-lio/`);
const [call] = fake.deepseek();
assert.equal(call.init.headers.Authorization, "Bearer sk-test-key");
const sent = JSON.parse(call.init.body);
assert.equal(sent.model, "deepseek-flash");
assert.equal(sent.stream, true);
assert.ok(sent.messages[0].content.includes("Batch-LIO"), "retrieved material must be in the system prompt");
assert.equal(sent.messages.at(-1).content, "为什么批量更新会更快？");
const today = new Date().toISOString().slice(0, 10);
assert.equal(testEnv.PET_LIMITS.store.get(`tokens:${today}`), "321");
assert.ok(!logged.some((line) => line.includes("批量更新")), "visitor messages must never be logged");

// 只接受以访客消息结尾的对话
response = await handleRequest(
  chatRequest({
    messages: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ],
  }),
  env(),
  { fetch: fakeFetch().fetcher }
);
assert.equal(response.status, 400);

// 每日预算用完：不调用模型
fake = fakeFetch();
testEnv = env({ DAILY_TOKEN_BUDGET: "1000" });
await testEnv.PET_LIMITS.put(`tokens:${today}`, "1000");
response = await handleRequest(chatRequest(ask("你好")), testEnv, { fetch: fake.fetcher });
assert.equal(response.status, 429);
assert.equal((await response.json()).error, "budget_exhausted");
assert.equal(fake.deepseek().length, 0);

// 同一 IP 每小时限量
fake = fakeFetch();
testEnv = env({ PER_IP_HOURLY_LIMIT: "2" });
for (let i = 0; i < 2; i += 1) {
  response = await handleRequest(chatRequest(ask(`问题 ${i}`)), testEnv, { fetch: fake.fetcher });
  assert.equal(response.status, 200);
  await response.text();
}
response = await handleRequest(chatRequest(ask("第三个问题")), testEnv, { fetch: fake.fetcher });
assert.equal(response.status, 429);
assert.equal((await response.json()).error, "rate_limited");

// 上游出错
console.error = () => undefined;
response = await handleRequest(chatRequest(ask("你好")), env(), { fetch: fakeFetch({ upstreamStatus: 500 }).fetcher });
console.error = originalError;
assert.equal(response.status, 502);
assert.equal((await response.json()).error, "upstream_error");

console.log("Pet brain checks passed: origin, letter guard, retrieval, streaming relay, token budget, rate limits, no content logging.");
