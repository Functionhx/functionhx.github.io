---
layout: post
title: "KVLedger 的 GPC 2026 审稿意见"
slug: "kvledger-gpc2026-reviews"
date: 2026-10-10 10:00:00 +0800
published: true
announce: true
description: "GPC 2026 录用论文《When Does KV Cache Compression Pay?》（KVLedger）的四份官方审稿意见原文。"
permalink: /blog/2026/kvledger-gpc2026-reviews/
lang: zh
locale: zh
translation_key: post-kvledger-gpc2026-reviews
kind: paper-note
tags: ["KV cache", "LLM serving", "审稿意见"]
categories: []
related_posts: false
---

我的论文 **When Does KV Cache Compression Pay? A Quality- and Cost-Aware Runtime Framework for Cloud LLM Serving**（系统名 KVLedger）被 GPC 2026 录用为 Regular Paper。会议 2026 年 12 月 4 日在南京举行，论文收入 Springer LNCS。项目主页：[functionhx.github.io/kv-compression-pays](https://functionhx.github.io/kv-compression-pays/)。

<!-- prettier-ignore -->
- R1 **−1** weak reject
- R2 **2** accept
- R3 **1** weak accept
- R4 **1** weak accept
{: .review-scores}

以下是录用通知（2026-09-29）中四位审稿人的意见原文。为了能在网页上显示，原文里的 LaTeX 公式改写成了普通字符，其余没有改动。

<section class="review-card review-card--reject" markdown="1">

## Review 1 · −1 weak reject {#review-1}

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

</section>

<section class="review-card review-card--accept" markdown="1">

## Review 2 · 2 accept {#review-2}

This paper studies an important and practical question in distributed LLM serving: when does KV cache compression actually provide a benefit? Instead of assuming that reducing the number of transferred bytes necessarily improves serving performance, the paper jointly considers compression/decompression overhead, metadata cost, transport latency, memory footprint, and model quality. The authors propose a measurement-calibrated runtime framework consisting of an adaptive INT4/INT8/FP16 codec with a writer-verified reconstruction-error bound, a fixed-cost-aware transport model, and a profile-based deployment resolver that selects a feasible compression configuration according to quality, latency, and memory constraints.

The problem is well motivated and practically relevant, particularly for disaggregated LLM serving where KV transfer can become an important system bottleneck. One of the strengths of the paper is that it challenges the common assumption that KV compression is always beneficial.

My main concern is that the technical novelty of the individual components is somewhat limited. The adaptive INT4/INT8/FP16 scheme is based on relatively straightforward block-wise quantization and fallback, while the deployment resolver essentially performs constraint filtering over offline measured profiles rather than introducing a sophisticated runtime optimization algorithm. Therefore, the main contribution lies more in the systematic formulation, measurement methodology, and integration of quality and system costs than in a fundamentally new compression or scheduling technique. In addition, the evaluation remains relatively limited in model scale and deployment environment. The quality study primarily considers models up to Qwen2.5-3B, whereas modern production LLM serving commonly involves substantially larger models. Since one of the central arguments is that KV magnitude and compression feasibility are model-dependent, experiments on larger models would make this conclusion considerably stronger. The communication evaluation is also mostly limited to PCIe/same-host settings; evaluation over realistic disaggregated environments such as high-speed NIC/RDMA or NVLink would better establish how broadly the reported crossover behavior generalizes.

</section>

<section class="review-card review-card--weak" markdown="1">

## Review 3 · 1 weak accept {#review-3}

This paper studies when KV-cache compression is actually beneficial for distributed LLM serving rather than assuming that fewer transferred bytes automatically imply lower latency. It proposes a runtime framework combining a writer-verified adaptive INT4/INT8/FP16 codec, a fixed-cost-aware transport model, and a profile-based deployment resolver that jointly considers quality, latency, and memory constraints.

Comments:

1. The distinction between the reconstruction certificate and an actual model-quality guarantee should be emphasized further. The certificate only bounds element-wise KV reconstruction error and explicitly does not bound attention outputs; the quality SLO used by the resolver still comes from offline perplexity measurements. It would be useful to discuss how robust the selected B value is under workload or distribution shifts.
2. The resolver is currently evaluated over a rather small discrete candidate set and a limited number of models/workloads. More evidence across additional LLM families and downstream tasks would strengthen the claim that the framework can serve as a general deployment decision mechanism rather than a model-specific profiler.
3. The networking evaluation is still somewhat limited. Although the dual-L40 PCIe P2P experiment is useful, the end-to-end validation does not cover realistic disaggregated-serving networks such as RDMA/Ethernet or InfiniBand. Since the main conclusion is explicitly link-dependent, at least one real inter-node experiment would considerably strengthen the paper.
4. The paper discusses several closely related runtime KV systems, but the end-to-end comparison against existing compression/transport approaches is limited. A direct system-level comparison with representative approaches such as CacheGen/KVServe/HACK, where feasible, would make the practical advantage of the proposed resolver clearer.

</section>

<section class="review-card review-card--weak" markdown="1">

## Review 4 · 1 weak accept {#review-4}

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

</section>
