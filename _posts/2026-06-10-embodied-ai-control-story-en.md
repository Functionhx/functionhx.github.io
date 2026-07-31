---
layout: post
title: "Pure CS Is Turning an Embodied-AI Control Problem into a Funding Story"
slug: embodied-ai-control-story
date: 2026-06-10 15:19:40 +0800
description: A control-and-systems perspective on what gets lost when a pure-CS paradigm and the VLA narrative take the lead in embodied AI.
permalink: /en/blog/2026/embodied-ai-control-story/
lang: en
locale: en
translation_key: post-embodied-ai-control-story
kind: writing
tags: [embodied-ai, control, VLA]
categories: [opinion]
related_posts: false
giscus_comments: true
---

## Letting a Pure-CS Paradigm Lead Embodied AI Is Creating a VLA-Shaped Bubble

> Treating actions as just another kind of token, and treating control as an inconvenience that data scaling can bypass, may be the most expensive misconception in this field.

Let me begin with a disclaimer. I am not looking down on computer science, nor am I trying to create a divide between disciplines. This is simply a discussion about cognitive paradigms and real-world systems engineering.

For a long time, I held a rather naïve belief: if they were willing to study control seriously, most people coming from a pure-CS background—whether they had worked on back-end systems, programming contests, visual recognition, or large-model training—could move into robot control, autonomous-driving decision-making, or even control-theory research without much difficulty.

After intensive study of control theory, hands-on robot debugging, and countless cross-disciplinary conversations about first principles, I realized that I was wrong.

I have had to accept an uncomfortable reality. The basic way many people with pure-CS backgrounds understand the world can clash with the rigorous framework that colleagues in automation, mechanical engineering, and robotics build around “physical systems—dynamic evolution—feedback loops.” The resulting cognitive friction is real and difficult to eliminate.

In everyday discussions, they are often the ones who first bring up robotics or autonomous driving. Yet as soon as the conversation moves beyond “which model did you use, how large is the network, and what score did the dataset reach” toward system dynamics, state estimation, stability, observability, real-time constraints, and closed-loop safety, I often see the habits of pure-CS thinking begin to retreat from the problem.

To fill that gap, people instinctively reach for generalized language borrowed from paper abstracts or promotional writing, flattening the actual complexity: “end-to-end learning will discover it automatically,” “with enough data you no longer need models,” “Transformers can unify everything,” or “isn’t the controller just an MLP at the end?”

The hard technical reality is that dynamics constraints, sensor noise, actuator latency, friction, saturation, modeling error, and closed-loop stability cannot be made to disappear through narrative.

The pure-CS and internet-algorithm paradigm is built around discrete inputs, static datasets, explicit loss functions, and reproducible offline evaluation. The control-and-robotics paradigm deals with continuous time, dynamic evolution, feedback loops, physical constraints, and uncertainty everywhere. In an offline dataset, one bad prediction might lower accuracy by a fraction of a point. In a real closed-loop system, one sampling period of latency, one incorrect sign, one wrong coordinate transformation, or one overlooked actuator saturation can send the entire system directly from stable operation into divergence.

Using the mindset of static prediction to understand dynamic control is, in my view, bound to produce repeated misunderstandings.

### A Provocative Claim: Much of Today’s VLA Narrative Is a Story for Investors Who Do Not Understand Control

I know this statement will draw criticism, but I still think it needs to be said. The most heavily promoted VLA work in the current wave of embodied AI often looks less like a control technology being deployed and more like a narrative tailored for fundraising.

VLA reframes “vision + language + proprioceptive state → action” as a large-scale sequence-modeling problem. The implication is that, given a large enough model and enough data, robot control can be “learned end to end” in the same way as a large language model.

The most compelling feature of this narrative is not necessarily how correct it is, but how easy it is to sell. It repackages a closed-loop control problem that control and robotics researchers have worked on for decades—and still have not fully solved—as a scaling problem that can supposedly be overcome with enough money and data. Money and compute are precisely what investors can provide. A decades-old engineering challenge is translated into a growth story that investors can understand and are willing to fund.

There are several very simple tests for distinguishing technology from rhetoric:

**First, look at what it shows you.** Fundraising shows edited demo videos and carefully arranged tabletop scenes in a laboratory. Deployment is about closed-loop reliability that does not fail, 24 hours a day, seven days a week. The gap between one selected successful grasp and a system that can run for a week in an open environment without collision, dropping objects, or losing stability is not a few percentage points; it is the whole discipline of control engineering. A pitch deck will almost always show the former.

**Second, look at what it measures.** “Action-prediction accuracy” and “task success rate” above 90% in carefully staged settings sound impressive. But the measures that actually determine whether a robot is usable—mean time between closed-loop failures, safety margins in out-of-distribution states, error accumulation over long rollouts, and whether contact forces lead to slip—are difficult, unflattering, and hard to optimize. You almost never see them in fundraising material. Selective reporting is not itself fraud, but reporting only metrics that say little about real reliability is difficult to dismiss as accidental.

**Third, look at how it explains failure.** Real engineering identifies a cause: state estimation drifted, actuator latency exceeded a limit, or the controller became unstable in a particular operating regime. A fundraising narrative has only one explanation: “the next model will fix it” or “one more order of magnitude of data will solve it.” Falsification is systematically postponed until after the next funding round. A technical promise that can never be falsified and always places its answer in “bigger and more” is cognitively similar to a Ponzi structure: new money is needed to preserve the credibility of the previous story.

I am not saying that everyone working on VLA is deceiving people. Most researchers are sincere, and VLA has genuinely brought open-world semantic understanding to robots at a level that was previously missing. My point is this:

**When a technology that is still far from solving closed-loop reliability is packaged as a disruptive claim that “end-to-end systems will soon replace state estimation, motion planning, and feedback control,” and that claim is used to unlock enormous funding, the narrative has quietly shifted from serving robotics to serving fundraising itself.**

The people most likely both to create and believe this story are often those whose intuition was trained only on static datasets and who have never been punished by divergence or collisions in a real feedback loop. Within that cognitive paradigm, “predicting accurately” and “controlling successfully” are assumed to be the same thing. That assumption is where the entire misunderstanding begins.

### First Principles Are Not a Slogan for a Business Presentation

This cognitive friction is especially visible in the way people use the term “first principles.” When many CS and AI practitioners discuss first-principles thinking, the same associations appear: Elon Musk, breaking a problem down, end-to-end learning, and letting the model discover the rules. A concept rooted in physical modeling and axiomatic reasoning is reduced to a business method or a slogan for the era of large models.

What do first principles mean for a control system? To me, they mean starting from Newton–Euler equations, rigid-body kinematics, conservation of energy, circuit laws, and system constraints; constructing a mathematical model that can describe the real object; and then rigorously analyzing equilibrium, controllability, observability, stability, robustness, and optimality. An inverted pendulum does not balance because a neural network “understands” equilibrium. A race car does not take a corner at high speed merely because a model has seen enough turns in a dataset. Without systematic training in classical control, modern control, signals and systems, dynamics, and state estimation—and without wrestling repeatedly with Laplace transforms, state space, Lyapunov stability, and the mathematics of nonlinear systems—the claim that a model will “learn control by itself” is a structure built on the limited support of a finite data distribution.

Claims that there is no barrier between AI and robotics often confuse learning engineering tools with rebuilding one’s underlying intuition. Using PyTorch, training a perception model, changing a network architecture, and running open-source code are closer to a framework and workflow; with intensive training, a pure-CS practitioner can absolutely master them. Work at the deeper and more advanced layers—nonlinear control, model predictive control, state estimation, real-time optimization, robust control, and genuine closed-loop learning in embodied systems—requires strong intuition about system state, dynamic response, time and frequency domains, noise propagation, physical constraints, and stability margins.

That intuition needs long-term mathematical and engineering training. It may only take shape after watching real systems oscillate, overshoot, diverge, lose stability, and crash again and again. Without that training, beautiful offline metrics and sophisticated narratives may offer little help when the real problem is model mismatch, asynchronous sensors, actuator delay, tire slip, or closed-loop instability.

My disillusionment is really a correction to an earlier assumption: that someone skilled in software and algorithms can take a few control courses and naturally cross the foundational gap between “processing information” and “manipulating the physical world.”

Of course, the incompatibility runs in both directions. Someone trained only in classical control, with no systematic background in computer science, may be equally naïve when asked to design a large-scale distributed system, optimize a CUDA kernel, analyze a compiler, build a foundation model, or process data at massive scale. They may fall into their own version of “just add a PID controller.”

The rational response is neither to argue that one discipline is superior nor to deny all of VLA’s value. It is to respect the gap between paradigms and recognize their boundaries. Computer science excels at building computational systems, processing information, and scaling algorithms. Control and automation excel at describing dynamic worlds, managing feedback and constraints, and keeping systems stable under uncertainty. Different cognitive strengths should be applied where they belong, rather than using one fundraising narrative to conceal the hard constraints that another discipline has spent decades confronting.

---

The Chinese original was published on [Zhihu](https://zhuanlan.zhihu.com/p/2048053637985859286) on June 10, 2026.
