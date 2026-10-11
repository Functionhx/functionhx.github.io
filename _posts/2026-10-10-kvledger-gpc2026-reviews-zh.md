---
layout: post
title: "KVLedger 的 GPC 2026 审稿意见与回应"
slug: "kvledger-gpc2026-reviews"
date: 2026-10-10 10:00:00 +0800
published: true
announce: true
description: "GPC 2026 录用论文《When Does KV Cache Compression Pay?》的四份审稿意见原文，以及 camera-ready 阶段逐条怎么改、哪些留给期刊扩展版。"
permalink: /blog/2026/kvledger-gpc2026-reviews/
lang: zh
locale: zh
translation_key: post-kvledger-gpc2026-reviews
kind: paper-note
tags: ["KV cache", "LLM serving", "审稿意见"]
categories: ["论文札记"]
related_posts: false
---

我的论文 **When Does KV Cache Compression Pay? A Quality- and Cost-Aware Runtime Framework for Cloud LLM Serving**（系统名 KVLedger）被 GPC 2026 录用为 Regular Paper。会议 2026 年 12 月 4 日在南京举行，论文收入 Springer LNCS。项目主页：[functionhx.github.io/kv-compression-pays](https://functionhx.github.io/kv-compression-pays/)。

这篇札记前半部分是四位审稿人的意见原文。为了能在网页上显示，原文里的 LaTeX 公式改写成了普通字符，其余没有改动。后半部分记录 camera-ready 阶段我怎么回应这些意见。

## 结果

录用通知日期为 2026-09-29。

| 审稿人 | 分数           |
| ------ | -------------- |
| R1     | −1 weak reject |
| R2     | 2 accept       |
| R3     | 1 weak accept  |
| R4     | 1 weak accept  |

## 审稿意见原文

### Review 1 — Overall evaluation: −1 (weak reject)

Thank you for submitting your work to GPC 2026.

This paper studies when KV-cache compression is beneficial in disaggregated LLM serving rather than assuming that fewer transferred bytes imply lower latency. It combines an adaptive per-block INT4/INT8/FP16 codec with a writer-side reconstruction-error check, a transport ledger that includes codec, metadata, transfer, and consumer costs, and a profile-based resolver that filters candidate operating points using quality, latency, and memory constraints. Measurements on OPT-125M, TinyLlama-1.1B, and Qwen2.5-3B show that uniform INT4 quality is model-dependent, while transport experiments report no benefit on a same-GPU proxy, crossovers around 1.06–2.08 MB on one PCIe proxy, and 23–46 MB in a dual-L40 P2P pipeline.

Below are some suggestions for improvments:

(1) Clarify the meaning and value of the certificate. Gate G2 recomputes ‖X − X̂‖∞ while the trusted writer still has both X and the packed representation, and Lemmas 1–2 follow immediately from independent immutable writes. This can detect implementation faults, but it neither certifies perplexity nor bounds attention/output error, and the receiver cannot verify the claim without the original KV. Please avoid language that may suggest an end-to-end quality certificate. A more compelling contribution would connect the runtime bound to attention error or task quality, along the direction of the runtime-bound work that the paper itself cites, and quantify how often G2 catches naturally occurring implementation or numerical failures rather than injected faults.

(2) Better separate the contribution from prior KV quantization and transport systems. KVQuant (Hooper et al., NeurIPS 2024), KIVI (Liu et al., ICML 2024), CacheGen (Liu et al., SIGCOMM 2024), HACK (Zhang et al., SIGCOMM 2025), and KVServe (Liu et al., SIGCOMM 2026) already establish rate–quality and runtime-aware KV compression. The new resolver is constraint filtering over five measured candidates, and the codec uses standard blockwise max-scale quantization with fallback. Please provide direct, same-hardware comparisons with these systems or isolate what cannot be reproduced. The PackKV comparison alone is insufficient because its attention-weighted repacking stage is not exercised and its test hardware differs from the main transport grid.

(3) Unify the latency evaluation. The paper reports an RTX 4070 Ti codec profile under a co-tenant-load flag, an A100 same-GPU/host-transfer grid, a single-A100 two-process host relay, and a dual-L40 P2P test. The resulting crossover moves from 1.06–2.08 MB to 23–46 MB, demonstrating the paper's thesis but also showing that one profile cannot support a general deployment claim. Please evaluate complete compressed and FP16 paths on the same hardware for PCIe P2P, NVLink, and a real inter-node NIC/RDMA path, including overlap among codec, transfer, and decode. Serialized execution can substantially misestimate a pipelined disaggregated serving system.

(4) Strengthen end-to-end integration. The "live vLLM" experiment validates writes, but the receiving worker uses a Transformers `DynamicCache` rather than vLLM's decode path. The host-relay adaptive implementation takes 4.0 s and is excluded from performance conclusions. In the L40 experiment, end-to-end latency is decode-dominated, varies by hundreds of milliseconds, and does not consistently track the microsecond-to-millisecond transport savings. Please implement both prefill and decode workers in the intended serving stack, report request latency, time-to-first-token, inter-token latency, throughput under concurrency, memory capacity, and confidence intervals, and show when the transfer-phase gain changes an actual serving SLO.

(5) Expand quality validation. WikiText-2 perplexity with fixed 512-token windows on only three models is too narrow for deployment resolution, especially when the key negative result is a catastrophic Qwen2.5-3B INT4 failure. Please verify that collapse, report absolute perplexities and numerical stability diagnostics, and add long-context and downstream evaluations on more architectures and sizes. The 32/32 or 128-token continuation match is not an adequate quality metric; the reported 0.84–0.97 match on the dual-GPU path also needs interpretation. Quality profiles should include uncertainty and should not be treated as valid outside the exact model, context, and workload measured.

(6) Evaluate the resolver as a runtime mechanism. The current resolver consumes static profiles and chooses the largest feasible ratio; it does not adapt online, model uncertainty, queueing, contention, or changing links. Show profile-collection cost, interpolation error, sensitivity to stale or noisy measurements, and behavior when constraints or message sizes change. Compare against simple policies such as FP16, fixed INT8, and "compress above a measured size threshold." Without such evidence, the resolver appears to be a small configuration script rather than a substantive runtime contribution.

(7) Improve presentation and reproducibility. Consolidate the several transport regimes into one table that states physical path, hardware, software, bytes, codec stages, overlap policy, and applicable claims. Give variance or confidence intervals rather than medians alone, release the 192-cell grid and resolver inputs, and distinguish MiB from MB consistently. The anonymous manuscript also cites several 2026 works with incomplete bibliographic information; all contemporaneous comparisons should be verifiable.

### Review 2 — Overall evaluation: 2 (accept)

This paper studies an important and practical question in distributed LLM serving: when does KV cache compression actually provide a benefit? Instead of assuming that reducing the number of transferred bytes necessarily improves serving performance, the paper jointly considers compression/decompression overhead, metadata cost, transport latency, memory footprint, and model quality. The authors propose a measurement-calibrated runtime framework consisting of an adaptive INT4/INT8/FP16 codec with a writer-verified reconstruction-error bound, a fixed-cost-aware transport model, and a profile-based deployment resolver that selects a feasible compression configuration according to quality, latency, and memory constraints.

The problem is well motivated and practically relevant, particularly for disaggregated LLM serving where KV transfer can become an important system bottleneck. One of the strengths of the paper is that it challenges the common assumption that KV compression is always beneficial.

My main concern is that the technical novelty of the individual components is somewhat limited. The adaptive INT4/INT8/FP16 scheme is based on relatively straightforward block-wise quantization and fallback, while the deployment resolver essentially performs constraint filtering over offline measured profiles rather than introducing a sophisticated runtime optimization algorithm. Therefore, the main contribution lies more in the systematic formulation, measurement methodology, and integration of quality and system costs than in a fundamentally new compression or scheduling technique. In addition, the evaluation remains relatively limited in model scale and deployment environment. The quality study primarily considers models up to Qwen2.5-3B, whereas modern production LLM serving commonly involves substantially larger models. Since one of the central arguments is that KV magnitude and compression feasibility are model-dependent, experiments on larger models would make this conclusion considerably stronger. The communication evaluation is also mostly limited to PCIe/same-host settings; evaluation over realistic disaggregated environments such as high-speed NIC/RDMA or NVLink would better establish how broadly the reported crossover behavior generalizes.

### Review 3 — Overall evaluation: 1 (weak accept)

This paper studies when KV-cache compression is actually beneficial for distributed LLM serving rather than assuming that fewer transferred bytes automatically imply lower latency. It proposes a runtime framework combining a writer-verified adaptive INT4/INT8/FP16 codec, a fixed-cost-aware transport model, and a profile-based deployment resolver that jointly considers quality, latency, and memory constraints.

Comments:

1. The distinction between the reconstruction certificate and an actual model-quality guarantee should be emphasized further. The certificate only bounds element-wise KV reconstruction error and explicitly does not bound attention outputs; the quality SLO used by the resolver still comes from offline perplexity measurements. It would be useful to discuss how robust the selected B value is under workload or distribution shifts.
2. The resolver is currently evaluated over a rather small discrete candidate set and a limited number of models/workloads. More evidence across additional LLM families and downstream tasks would strengthen the claim that the framework can serve as a general deployment decision mechanism rather than a model-specific profiler.
3. The networking evaluation is still somewhat limited. Although the dual-L40 PCIe P2P experiment is useful, the end-to-end validation does not cover realistic disaggregated-serving networks such as RDMA/Ethernet or InfiniBand. Since the main conclusion is explicitly link-dependent, at least one real inter-node experiment would considerably strengthen the paper.
4. The paper discusses several closely related runtime KV systems, but the end-to-end comparison against existing compression/transport approaches is limited. A direct system-level comparison with representative approaches such as CacheGen/KVServe/HACK, where feasible, would make the practical advantage of the proposed resolver clearer.

### Review 4 — Overall evaluation: 1 (weak accept)

Summary: This paper studies when KV cache compression is beneficial for disaggregated LLM serving, considering both output quality and system overhead. It presents an adaptive KV codec that selects INT4, INT8, or FP16 for individual blocks according to a reconstruction-error budget. Each compressed write is verified against the specified error bound before being committed. The paper also develops a transport cost model that accounts for compression, metadata, data transfer, and decompression/consumer overhead, showing that compression becomes beneficial only beyond a hardware- and message-size-dependent crossover point. Based on measured quality, latency, and memory profiles, a deployment resolver selects a feasible compression configuration under operator-specified constraints. The framework is integrated with vLLM and evaluated using several language models and GPU configurations. Results show that the appropriate compression level depends strongly on model characteristics and the underlying communication path, and that reducing KV cache size does not necessarily reduce end-to-end latency.

Strengths:

- This paper provides an explicit reconstruction-error guarantee for adaptive KV cache compression through per-write verification.
- This paper systematically characterizes the conditions under which KV cache compression delivers actual performance benefits.

Weaknesses:

- The connection between the reconstruction-error bound and generation quality is insufficiently justified.
- The performance evaluation does not adequately account for pipeline overlap.
- The evaluation lacks comparisons with closely related systems.
- The quality evaluation is limited in scope.

Comments for authors: Thank you for submitting your paper to GPC '26. The paper presents a reasonably complete and well-evaluated system; however, several aspects of its quality guarantees, evaluation methodology, and novelty over existing systems require further clarification and validation. Below are my detailed comments and questions.

1. The paper does not sufficiently establish a strong connection between the per-write KV reconstruction-error bound and the actual generation quality. The proposed certificate only bounds the numerical reconstruction error of the KV cache, while its relationship to attention outputs, logits, or downstream task quality remains largely empirical.
2. The main performance evaluation assumes serialized codec–transfer–decode execution and does not adequately consider pipelining or overlap between compression, KV transfer, decompression, and computation, which may substantially change the reported crossover points and the practical benefits of compression.
3. The evaluation lacks direct comparisons with closely related KV compression and disaggregated serving systems, such as KVServe, CacheGen, and HACK, making it difficult to assess the incremental performance benefits and novelty of the proposed framework over existing approaches.
4. The quality evaluation relies primarily on perplexity measurements on WikiText-2, which is insufficient to demonstrate that the proposed error bounds reliably preserve generation quality across realistic LLM workloads. Evaluation on downstream tasks, long-context workloads, and larger models would provide stronger evidence for the claimed quality guarantees.
5. The authors should consider giving the implemented system a distinct name.

## 意见归纳

四份意见高度重合，集中在五件事上：

1. **"certificate" 这个说法说过头了**（R1-1、R3-1、R4-1）。写端校验只约束逐元素的 KV 重建误差，不约束注意力输出，也不约束生成质量。resolver 用的质量 SLO 仍然来自离线 PPL。
2. **新颖性**（R1-2、R2）。codec 是标准的分块量化加回退，resolver 是在离线 profile 上做约束过滤。贡献在核算框架和测量方法，不在新的压缩算法。
3. **链路覆盖不够**（R1-3、R2、R3-3、R4-2）。没有同硬件的 NVLink、RDMA 或跨节点实验，主实验也是串行执行，没有考虑 overlap。
4. **质量评测太窄**（R1-5、R2、R3-2、R4-4）。只测了三个 3B 以下的模型、WikiText-2 PPL，没有长上下文和下游任务。
5. **缺少同类系统对比**（R1-2、R3-4、R4-3），没有和 CacheGen、HACK、KVServe 在同一硬件上比较。

## camera-ready 改了什么

这些改动分两轮完成：2026-10-02 和 2026-10-09。原则有两条：不改 LNCS 版式，保持 16 页；不补编任何实验数字。

- **措辞收敛。** 全文把 "certificate/certified" 改为 "writer-verified / verification record"，引言不再说逐次写入校验"让部署决策可信"。Qwen2.5-3B 的 INT4 崩溃改回正确的归因：拒绝 INT4 的是 resolver 的选择规则，不是写端校验（gate G2）。贡献 3 从 "validated by live vLLM" 改为 "exercised on live vLLM paged KV"，因为接收端用的是 transformers `DynamicCache`。
- **系统命名。** 按 R4-5 的建议，系统命名为 KVLedger。
- **统一测量环境表**（R1-3、R1-7）。新增 Table 1，把四种 GPU 上的实验按"环境 × 路径 × 规模 × 支持哪条结论"列在一起。crossover 一律写明链路：A100 host round trip（D2H+H2D）上是 1.06–2.08 MB，双 L40 P2P 上是 23–46 MB。
- **与简单策略对比**（R1-6）。新增一节，用已有测量回放 always-fp16、固定 INT8、固定 INT4 和阈值策略，没有做新实验。
- **主动交代新颖性**（R1-2、R2）。引言里直接写明 codec 和 resolver 本身都很简单，贡献在核算框架。相关工作和局限两节写明没有复现 CacheGen、HACK、KVServe，也写明它们怎样通过三条测量曲线接入 resolver。
- **串行执行的影响**（R1-3、R4-2）。补了理想 overlap 下 max(codec, xfer) 的估算。
- **G2 的自然触发率**（R1-1）。报告了 220 次 live 写入、0 次触发。
- **如实陈述端到端延迟**（R1-4）。删掉 "flat across arms" 和 "~1000× faster"。L40 实验的端到端差异远大于 ≤1.1 ms 的传输节省，所以不下端到端延迟的结论。这两轮唯一改动的数字是把 e2e 范围从 "2.5–4.0 s" 订正为表里实际的 "2.5–3.7 s"。
- **格式与可复现性**（R1-7）。2026 年文献补全了作者、编号和 DOI；统一了 KiB/MiB 与 KB/MB；删掉了 GPC 没有渠道提供的 "supplementary material" 指引。局限一节如实写明只报中位数、没有置信区间。

## 留给期刊扩展版的

下面这些意见需要新实验，camera-ready 里只能写进 Limitations：

1. 同一硬件上的 NVLink、RDMA/InfiniBand、跨节点 NIC 路径，以及带 overlap 的流水线实测（R1-3、R2、R3-3、R4-2）；
2. 7B 以上的模型、长上下文、下游任务，以及绝对 PPL 和数值稳定性诊断（R1-5、R2、R3-2、R4-4）；
3. prefill 和 decode 都放进 vLLM，报告 TTFT、ITL、并发吞吐和置信区间（R1-4）；
4. resolver 对过时或带噪 profile 的敏感性、profile 采集成本和插值误差（R1-6、R3-1）；
5. 与 CacheGen、HACK、KVServe 在同一硬件上的系统级对比（R1-2、R3-4、R4-3）。

其中第 1、2 项最有分量，是扩展版的主线。
