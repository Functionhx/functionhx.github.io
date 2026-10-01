(function initializeTrainingCard() {
  "use strict";

  // 首页的模型训练进度卡片。所有数字和曲线都是训练过程的典型形状（快速下降 + 长尾收敛、
  // warmup + 余弦退火的学习率），按真实经过的时间从几个常量用公式算出来，不读取、
  // 不存储任何真实训练产生的数据，也没有任何网络请求——同一时刻的所有访客看到完全一样的
  // step/loss/lr，这一点和"实时"的直觉是一致的。

  const card = document.querySelector("[data-training-card]");
  if (!card) return;

  // 训练"开始"的时间点：从这一刻起按 STEPS_PER_SECOND 推进 step。
  const TRAINING_START_MS = Date.parse("2026-10-01T00:00:00Z");
  const STEPS_PER_SECOND = 2;
  const TOKENS_PER_STEP = 4_194_304; // 1024 条序列 × 4096 token，常见的大批量预训练设置。

  // Loss 曲线：floor + range * (1 + step/k)^-power，前几百步快速下降、长尾缓慢收敛到 floor。
  const LOSS_PEAK = 9.2;
  const LOSS_FLOOR = 1.55;
  const LOSS_K = 50;
  const LOSS_POWER = 0.4;

  // 学习率：线性 warmup 后余弦退火，到 LR_TOTAL_STEPS 衰减到 LR_MIN 并保持。
  const LR_PEAK = 3e-4;
  const LR_MIN = 3e-5;
  const LR_WARMUP_STEPS = 2000;
  const LR_TOTAL_STEPS = 1_000_000;

  function currentStep(nowMs) {
    const elapsedSeconds = Math.max(0, (nowMs - TRAINING_START_MS) / 1000);
    return elapsedSeconds * STEPS_PER_SECOND;
  }

  // 平滑的、仅由 step 决定的"训练噪声"：同一个 step 永远算出同一个值，不用随机数，
  // 这样图表在每次刷新、每个访客那里都是同一条曲线，只是右端随时间往前推进。
  function noiseFraction(step) {
    return Math.sin(step * 0.013) * 0.5 + Math.sin(step * 0.047 + 1.3) * 0.3 + Math.sin(step * 0.191 + 2.7) * 0.2;
  }

  function lossAt(step) {
    const base = LOSS_FLOOR + (LOSS_PEAK - LOSS_FLOOR) * Math.pow(1 + step / LOSS_K, -LOSS_POWER);
    const amplitude = Math.max(0, (base - LOSS_FLOOR) * 0.05);
    return Math.max(LOSS_FLOOR * 0.98, base + amplitude * noiseFraction(step));
  }

  function learningRateAt(step) {
    if (step < LR_WARMUP_STEPS) return (LR_PEAK * step) / LR_WARMUP_STEPS;
    const progress = Math.min((step - LR_WARMUP_STEPS) / (LR_TOTAL_STEPS - LR_WARMUP_STEPS), 1);
    return LR_MIN + 0.5 * (LR_PEAK - LR_MIN) * (1 + Math.cos(Math.PI * progress));
  }

  // GPU 利用率/吞吐量是纯装饰性的小数字，按真实墙钟时间小幅摆动，强调"正在运行"的观感。
  function gpuUtilAt(nowMs) {
    const t = nowMs / 1000;
    return 95 + 3 * Math.sin(t * 0.3) + 1.5 * Math.sin(t * 1.7 + 0.5);
  }

  function throughputAt(nowMs) {
    const t = nowMs / 1000;
    return TOKENS_PER_STEP * STEPS_PER_SECOND * (1 + 0.04 * Math.sin(t * 0.5 + 2));
  }

  function snapshot(nowMs = Date.now()) {
    const step = currentStep(nowMs);
    return {
      step,
      tokens: step * TOKENS_PER_STEP,
      loss: lossAt(step),
      lr: learningRateAt(step),
      gpu: gpuUtilAt(nowMs),
      throughput: throughputAt(nowMs),
    };
  }

  // 同 contrail-card.js 的 formatCompact：一位小数、去掉末尾 0，进位到下一个单位。
  function formatCompact(value) {
    const abs = Math.abs(Number(value) || 0);
    if (abs < 1000) return String(Math.round(abs));
    const withSuffix = (number, suffix) => `${Number(number.toFixed(1))}${suffix}`;
    const withCarry = (number, suffix, nextSuffix) => {
      const rounded = Number(number.toFixed(1));
      return rounded >= 1000 ? withSuffix(rounded / 1000, nextSuffix) : `${rounded}${suffix}`;
    };
    if (abs >= 1e12) return withSuffix(abs / 1e12, "T");
    if (abs >= 1e9) return withCarry(abs / 1e9, "B", "T");
    if (abs >= 1e6) return withCarry(abs / 1e6, "M", "B");
    return withCarry(abs / 1e3, "K", "M");
  }

  function formatLr(value) {
    return value.toExponential(2);
  }

  function formatStarted(ms) {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  }

  const field = (name) => card.querySelector(`[data-training-field="${name}"]`);
  const setField = (name, value) => {
    const node = field(name);
    if (node) node.textContent = value;
  };

  const lossSvg = card.querySelector("[data-training-loss-svg]");
  const lrSvg = card.querySelector("[data-training-lr-svg]");
  const chartWrap = card.querySelector("[data-training-chart-wrap]");
  const tooltip = card.querySelector("[data-training-tooltip]");

  const SAMPLE_COUNT = 180;
  const LOSS_VIEW = { width: 600, height: 180 };
  const LR_VIEW = { width: 600, height: 40 };

  // 从 step=1 到当前 step 按对数间隔取 SAMPLE_COUNT 个点：训练前期的剧烈下降和长尾的
  // 缓慢收敛都看得清楚，这是训练曲线的通行画法（wandb/tensorboard 默认也是 log x）。
  function sampleSteps(maxStep) {
    const safeMax = Math.max(maxStep, 10);
    const samples = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const t = index / (SAMPLE_COUNT - 1);
      const step = safeMax <= 10 ? t * safeMax : Math.pow(safeMax, t);
      samples.push(Math.max(0.0001, step));
    }
    return samples;
  }

  function svgns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  let lastSamples = [];

  function renderLossChart(maxStep) {
    const samples = sampleSteps(maxStep);
    const losses = samples.map(lossAt);
    const logMax = Math.log10(Math.max(maxStep, 10));
    const minLoss = LOSS_FLOOR * 0.97;
    const maxLoss = Math.max(...losses, LOSS_PEAK);
    const points = samples.map((step, index) => {
      const x = (Math.log10(Math.max(step, 1)) / logMax) * LOSS_VIEW.width;
      const y = LOSS_VIEW.height - ((losses[index] - minLoss) / (maxLoss - minLoss)) * LOSS_VIEW.height;
      return [x, y];
    });
    lastSamples = samples.map((step, index) => ({ step, loss: losses[index], x: points[index][0] }));

    const linePath = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const areaPath = `${linePath} L${LOSS_VIEW.width},${LOSS_VIEW.height} L0,${LOSS_VIEW.height} Z`;

    lossSvg.replaceChildren();
    const area = svgns("path");
    area.setAttribute("class", "training-chart-area");
    area.setAttribute("d", areaPath);
    const line = svgns("path");
    line.setAttribute("class", "training-chart-line");
    line.setAttribute("d", linePath);
    lossSvg.append(area, line);
  }

  function renderLrChart(maxStep) {
    const samples = sampleSteps(maxStep);
    const rates = samples.map(learningRateAt);
    const logMax = Math.log10(Math.max(maxStep, 10));
    const maxRate = LR_PEAK;
    const points = samples.map((step, index) => {
      const x = (Math.log10(Math.max(step, 1)) / logMax) * LR_VIEW.width;
      const y = LR_VIEW.height - (rates[index] / maxRate) * LR_VIEW.height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    });
    lrSvg.replaceChildren();
    const line = svgns("path");
    line.setAttribute("class", "training-lr-line");
    line.setAttribute("d", points.join(" "));
    lrSvg.append(line);
  }

  function nearestSample(offsetX) {
    if (!lastSamples.length) return null;
    const ratio = offsetX / chartWrap.getBoundingClientRect().width;
    const targetX = ratio * LOSS_VIEW.width;
    let nearest = lastSamples[0];
    let bestDistance = Math.abs(nearest.x - targetX);
    for (const sample of lastSamples) {
      const distance = Math.abs(sample.x - targetX);
      if (distance < bestDistance) {
        nearest = sample;
        bestDistance = distance;
      }
    }
    return nearest;
  }

  function showTooltip(event) {
    const wrapBox = chartWrap.getBoundingClientRect();
    const sample = nearestSample(event.clientX - wrapBox.left);
    if (!sample) return;
    tooltip.textContent = `Step ${formatCompact(sample.step)} · Loss ${sample.loss.toFixed(3)} · LR ${formatLr(learningRateAt(sample.step))}`;
    tooltip.hidden = false;
    const left = Math.min(Math.max((sample.x / LOSS_VIEW.width) * wrapBox.width - tooltip.offsetWidth / 2, 0), wrapBox.width - tooltip.offsetWidth);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = "6px";
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function render() {
    const data = snapshot();
    setField("loss", data.loss.toFixed(3));
    setField("step", formatCompact(data.step));
    setField("tokens", formatCompact(data.tokens));
    setField("lr", formatLr(data.lr));
    setField("gpu", `${data.gpu.toFixed(1)}%`);
    setField("throughput", `${formatCompact(data.throughput)}/s`);
    setField("started", formatStarted(TRAINING_START_MS));
    renderLossChart(data.step);
    renderLrChart(data.step);
  }

  let timer = 0;
  function startTicking() {
    if (timer) return;
    render();
    timer = window.setInterval(render, 1000);
  }
  function stopTicking() {
    window.clearInterval(timer);
    timer = 0;
  }

  chartWrap.addEventListener("mousemove", showTooltip);
  chartWrap.addEventListener("mouseleave", hideTooltip);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTicking();
    else if (card.getAttribute("data-training-visible") === "true") startTicking();
  });

  // 开发/测试用的只读接口：给定任意时间戳算出当时的数字，不依赖计时器或 DOM。
  window.functionhxTrainingCard = { snapshot };

  if (!("IntersectionObserver" in window)) {
    card.setAttribute("data-training-visible", "true");
    startTicking();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      card.setAttribute("data-training-visible", visible ? "true" : "false");
      if (visible && !document.hidden) startTicking();
      else stopTicking();
    },
    { rootMargin: "200px 0px" }
  );
  observer.observe(card);
})();
