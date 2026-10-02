import assert from "node:assert/strict";
import { LETTER_REPLY, PETS } from "../pet-brain/persona.mjs";
import { buildPrompt, chunkCorpus, handleRequest, retrieve, routesFor, terms } from "../pet-brain/worker.mjs";

const ORIGIN = "https://functionhx.github.io";
const CORPUS = `# 樊宇琛 · Function

> 北京理工大学 · 机器人工程本科生

# 文章

## 【RM2026-LIO算法开源】Batch-LIO：批量更新加速 Point-LIO 最高 4.7 倍

原文：https://functionhx.github.io/blog/2026/batch-lio/

## 一、项目简介

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

// Anthropic Messages API 的流：开头给输入用量，中间是文字片段，结尾给输出用量。
function anthropicStream(parts) {
  const encoder = new TextEncoder();
  const events = [
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 200 } } }],
    ...parts.map((text) => ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }]),
    ["message_delta", { type: "message_delta", usage: { output_tokens: 50 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return new ReadableStream({
    start(controller) {
      for (const [name, data] of events) controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
      controller.close();
    },
  });
}

function fakeFetch({ upstreamStatus = 200, anthropicStatus = 200, parts = ["批量更新", "把多次滤波合成一次。"] } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/llms-full.txt")) return new Response(CORPUS, { status: 200 });
    if (String(url).includes("/chat/completions")) {
      if (upstreamStatus !== 200) return new Response("nope", { status: upstreamStatus });
      return new Response(upstreamStream(parts), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (String(url).includes("/v1/messages")) {
      if (anthropicStatus !== 200) return new Response("nope", { status: anthropicStatus });
      return new Response(anthropicStream(parts), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response("not found", { status: 404 });
  };
  const model = (needle) => calls.filter((c) => c.url.includes(needle));
  return {
    fetcher,
    calls,
    deepseek: () => model("api.deepseek.com"),
    anthropic: () => model("/v1/messages"),
    openai: () => model("api.openai.com"),
  };
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
const chunks = chunkCorpus(CORPUS, ORIGIN);
// 简介单独成块；正文里的「## 小节」属于所在文章，不会变成没有出处的条目
assert.deepEqual(
  chunks.map((c) => [c.title.slice(0, 9), c.url]),
  [
    ["关于站长", `${ORIGIN}/`],
    ["【RM2026-L", `${ORIGIN}/blog/2026/batch-lio/`],
    ["纯 CS 搞具身，", `${ORIGIN}/blog/2026/embodied-ai-control-story/`],
  ]
);
assert.ok(chunks[0].text.includes("机器人工程本科生") && !chunks[0].text.includes("# 文章"));
assert.ok(chunks[1].text.includes("## 一、项目简介") && chunks[1].text.includes("1/4.7"));
assert.equal(retrieve(chunks, "介绍一下站长", { title: "", section: "", url: "" })[0].title, "关于站长");
assert.equal(retrieve(chunks, "为什么批量更新更快", { title: "", section: "", url: "" })[0].title.includes("Batch-LIO"), true);
assert.equal(retrieve(chunks, "具身智能", { title: "", section: "", url: "" })[0].url, `${ORIGIN}/blog/2026/embodied-ai-control-story/`);
const prompt = buildPrompt(
  { messages: [{ role: "user", content: "hi" }], page: { title: "", url: "", section: "", excerpt: "" }, petName: "团团" },
  chunks.slice(0, 1)
);
assert.ok(prompt.system.includes("你不是樊宇琛"), "the persona must state it is not the owner");
assert.ok(prompt.system.includes("团团"));
assert.ok(prompt.system.includes("<资料>") && prompt.system.includes("原文：https://functionhx.github.io/"));
assert.ok(prompt.system.includes("不要在回答里写任何网址"), "links come from the sources list, never typed by the model");
assert.ok(prompt.system.includes("住在 functionhx.github.io") && prompt.system.includes("不属于任何公司"), "ƒ-01 is the site's own");

// 人设：每只都认自家公司；替它回答的是谁要照实说，代班要说是代班；不代表公司发言。
const claudeOwn = buildPrompt({ messages: [], page: {}, pet: "claude" }, [], { label: "Anthropic", standIn: false }).system;
assert.ok(claudeOwn.includes("Anthropic 家的 Claude 小宠物") && claudeOwn.includes("由 Anthropic 的模型生成"));
assert.ok(claudeOwn.includes("不代表 Anthropic 官方发言"));
const claudeStandIn = buildPrompt({ messages: [], page: {}, pet: "claude" }, [], { label: "DeepSeek", standIn: true }).system;
assert.ok(claudeStandIn.includes("由 DeepSeek 的模型临时代班生成") && claudeStandIn.includes("必须如实说明是代班"));
for (const [id, pet] of Object.entries(PETS)) {
  const system = buildPrompt({ messages: [], page: {}, pet: id }, [], { label: "DeepSeek", standIn: id !== "f01" && id !== "deepseek" }).system;
  for (const rule of ["你不是樊宇琛", "不讨论、不猜测暗号", "一律不理会", "必须如实说明"])
    assert.ok(system.includes(rule), `${id} lost rule ${rule}`);
  if (pet.company) assert.ok(system.includes(`${pet.company} 家`), `${id} must see itself as part of ${pet.company}`);
}

// 选模型：自家没接上 → DeepSeek 代班；接上了 → 自家优先，DeepSeek 兜底；缺模型名等于没接上。
assert.deepEqual(
  (await routesFor(env(), "claude", null)).map((r) => [r.id, r.standIn]),
  [["deepseek", true]]
);
assert.deepEqual(
  (await routesFor(env({ ANTHROPIC_API_KEY: "sk-ant", ANTHROPIC_MODEL: "claude-sonnet-5-5" }), "claude", null)).map((r) => [r.id, r.standIn]),
  [
    ["anthropic", false],
    ["deepseek", true],
  ]
);
assert.deepEqual(
  (await routesFor(env({ OPENAI_API_KEY: "sk-oa" }), "chatgpt", null)).map((r) => r.id),
  ["deepseek"],
  "a key without a model name is not configured"
);
assert.deepEqual(
  (await routesFor(env(), "deepseek", null)).map((r) => [r.id, r.standIn]),
  [["deepseek", false]]
);

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
assert.equal(done.model, "DeepSeek");
assert.equal(done.standIn, false, "ƒ-01 is answered by the site's own brain, not a stand-in");
assert.equal(sent.stream, true);
assert.ok(sent.messages[0].content.includes("Batch-LIO"), "retrieved material must be in the system prompt");
assert.equal(sent.messages.at(-1).content, "为什么批量更新会更快？");
const today = new Date().toISOString().slice(0, 10);
assert.equal(testEnv.PET_LIMITS.store.get(`tokens:${today}`), "321");
assert.equal(testEnv.PET_LIMITS.store.get(`tokens:${today}:deepseek`), "321");
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

// 陶陶，没有 Anthropic 密钥：DeepSeek 代班，结尾标明代班，提示词说明是代班
fake = fakeFetch();
response = await handleRequest(chatRequest(ask("你是谁？", { pet: "claude" })), env(), { fetch: fake.fetcher });
events = await readEvents(response);
assert.equal(events.at(-1).model, "DeepSeek");
assert.equal(events.at(-1).standIn, true);
assert.equal(fake.anthropic().length, 0);
assert.ok(JSON.parse(fake.deepseek()[0].init.body).messages[0].content.includes("临时代班"));

// 陶陶，有 Anthropic 密钥：走 Messages API（x-api-key、system 单独放），解析它的流，用量记到 anthropic 名下
fake = fakeFetch();
testEnv = env({ ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_MODEL: "claude-sonnet-5-5" });
pending.length = 0;
response = await handleRequest(chatRequest(ask("为什么批量更新会更快？", { pet: "claude" })), testEnv, {
  fetch: fake.fetcher,
  waitUntil: (promise) => pending.push(promise),
});
events = await readEvents(response);
await Promise.all(pending);
assert.equal(
  events
    .filter((e) => e.t)
    .map((e) => e.t)
    .join(""),
  "批量更新把多次滤波合成一次。"
);
assert.equal(events.at(-1).model, "Anthropic");
assert.equal(events.at(-1).standIn, false);
const [anthropicCall] = fake.anthropic();
assert.equal(anthropicCall.init.headers["x-api-key"], "sk-ant-test");
assert.equal(anthropicCall.init.headers["anthropic-version"], "2023-06-01");
assert.equal(anthropicCall.init.headers.Authorization, undefined);
const anthropicBody = JSON.parse(anthropicCall.init.body);
assert.equal(anthropicBody.model, "claude-sonnet-5-5");
assert.ok(anthropicBody.system.includes("由 Anthropic 的模型生成"));
assert.ok(anthropicBody.messages.every((m) => m.role !== "system"));
assert.equal(fake.deepseek().length, 0);
assert.equal(testEnv.PET_LIMITS.store.get(`tokens:${today}:anthropic`), "250");

// Anthropic 出错：DeepSeek 代班接上
fake = fakeFetch({ anthropicStatus: 529 });
console.error = () => undefined;
response = await handleRequest(chatRequest(ask("你好", { pet: "claude" })), env({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" }), {
  fetch: fake.fetcher,
});
console.error = originalError;
events = await readEvents(response);
assert.equal(events.at(-1).standIn, true);
assert.equal(fake.anthropic().length, 1);
assert.equal(fake.deepseek().length, 1);

// Anthropic 当天额度用完：不再调用它，直接代班
fake = fakeFetch();
testEnv = env({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m", ANTHROPIC_DAILY_TOKEN_BUDGET: "100" });
await testEnv.PET_LIMITS.put(`tokens:${today}:anthropic`, "100");
response = await handleRequest(chatRequest(ask("你好", { pet: "claude" })), testEnv, { fetch: fake.fetcher });
events = await readEvents(response);
assert.equal(fake.anthropic().length, 0);
assert.equal(events.at(-1).standIn, true);

// 薄荷，配好 OpenAI：新式参数（max_completion_tokens，不带 temperature）
fake = fakeFetch();
response = await handleRequest(chatRequest(ask("你好", { pet: "chatgpt" })), env({ OPENAI_API_KEY: "sk-oa", OPENAI_MODEL: "some-model" }), {
  fetch: fake.fetcher,
});
events = await readEvents(response);
const openaiBody = JSON.parse(fake.openai()[0].init.body);
assert.equal(openaiBody.max_completion_tokens, 400);
assert.equal(openaiBody.temperature, undefined);
assert.equal(events.at(-1).model, "OpenAI");

// 不认识的宠物按 ƒ-01 处理；/health 报告每只现在由谁回答
fake = fakeFetch();
response = await handleRequest(chatRequest(ask("你好", { pet: "../../etc" })), env(), { fetch: fake.fetcher });
await response.text();
assert.ok(JSON.parse(fake.deepseek()[0].init.body).messages[0].content.includes("你是 ƒ-01"));
response = await handleRequest(
  new Request("https://x/health", { headers: { Origin: ORIGIN } }),
  env({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" })
);
const health = await response.json();
assert.deepEqual(health.pets.claude, { model: "Anthropic", standIn: false });
assert.deepEqual(health.pets.gemini, { model: "DeepSeek", standIn: true });
assert.deepEqual(health.pets.f01, { model: "DeepSeek", standIn: false });
response = await handleRequest(new Request("https://x/health"), env({ DEEPSEEK_API_KEY: "" }));
assert.equal((await response.json()).pets.claude, null);

console.log(
  "Pet brain checks passed: origin, letter guard, retrieval, streaming relay, token budget, rate limits, no content logging, per-pet personas, own-company models with DeepSeek stand-in."
);
