---
layout: post
title: "Batch-LIO: Batch Updates Make Point-LIO up to 4.7× Faster"
slug: batch-lio
date: 2026-07-22 22:16:07 +0800
published: true
announce: true
description: Batch-LIO groups LiDAR points over roughly 1 ms and performs a joint update, reducing mean per-frame compute time by factors of 3.5× to 4.7× in the current sentinel Livox rosbag tests.
permalink: /en/blog/2026/batch-lio/
lang: en
locale: en
translation_key: post-batch-lio
kind: writing
tags: [LIO, robotics, open-source]
categories: [engineering]
related_posts: false
math: true
giscus_comments: true
---

## 1. Project Overview

Point-LIO uses point-wise updates, updating the system state at each sampling instant. This design provides a high odometry output rate and naturally avoids the motion distortion caused by accumulating a full point-cloud frame in conventional frame-based LIO systems.

The trade-off is a substantial computational cost. Many fine-grained point-cloud matching and filtering updates require the system to repeatedly perform nearest-neighbor search, plane fitting, residual construction, and EKF updates.

Inspired by the batch-update method in Haopeng Zhang’s undergraduate thesis on Batch-LIWO at the University of Science and Technology of China, Batch-LIO changes the update granularity of Point-LIO:

> LiDAR points acquired over approximately 1 ms are grouped into a batch. After motion compensation within the window, the filter performs one joint update.

The project currently provides:

- a ROS 1 Noetic version;
- a ROS 2 Humble version;
- an A/B switch between Point-LIO and Batch-LIO;
- unit tests for de-skewing within a batch;
- ROS 2 scripts for rosbag conversion, execution, and ablation testing.

Repository: [github.com/Functionhx/Batch-LIO](https://github.com/Functionhx/Batch-LIO)

## 2. Test Results

The current experiments use sentinel-robot Livox rosbags. The test platform is an x86 computer running Ubuntu 22.04.

With the same data and parameters, the Point-LIO-style fine-grained update is enabled by setting:

```yaml
batch_dt: 0.0
```

A 1 ms Batch-LIO update is enabled by setting:

```yaml
batch_dt: 0.001
```

The results under ROS 2 Humble are:

| Rosbag      | Point-LIO-style update | Batch-LIO 1 ms | Speedup |
| ----------- | ---------------------: | -------------: | ------: |
| quick-shack |               12.42 ms |        3.51 ms |    3.5× |
| outdoor_run |                2.56 ms |        0.54 ms |    4.7× |

These values are the mean compute time per point-cloud frame.

With the current test data and parameters, the Batch-LIO trajectories are close to the Point-LIO baseline; no obvious trajectory degradation was observed.

Tests across different batch windows show that increasing the window reduces the number of filter updates and further lowers compute time. A larger window, however, also increases motion-compensation error and may affect filter stability. The current recommendation is a `batch_dt` of 1–2 ms.

## 3. Core Method

### 3.1 Time-Window Grouping

Point-LIO is designed around point-wise updates. In practice, its implementation groups a small number of points with identical timestamps, but those groups are usually still small, so each frame requires many fine-grained updates.

Instead of grouping only points whose timestamps are exactly equal, Batch-LIO places neighboring points acquired over roughly 1 ms into the same window:

```text
Point-LIO:

[t₀] [t₁] [t₂] [t₃] [t₄] ...
 ↓    ↓    ↓    ↓    ↓
many small updates

Batch-LIO:

[       t₀ to tₙ, about 1 ms       ]
                  ↓
             one joint update
```

This substantially reduces the number of EKF updates performed for each frame.

### 3.2 Motion Compensation Within a Batch

Points in the same batch are not captured at the same instant, so they cannot be matched as though they were a simultaneous point cloud.

Batch-LIO compensates every point in the window to the sampling time of the final point.

For the $j$-th point, the time offset relative to the end of the window is:

$$
\Delta t_j = t_j - t_{\mathrm{last}}, \qquad \Delta t_j \le 0
$$

The rotational compensation is computed from the angular velocity in the current filter state:

$$
R_j = \operatorname{Exp}(\omega \Delta t_j)
$$

The translational compensation is:

$$
T_j = R_I^\top v \Delta t_j
$$

The compensated LiDAR point is then:

$$
p'_j = R_j p_j + T_j
$$

The linear velocity $v$ in the state is expressed in the world frame, whereas LiDAR motion compensation is performed in the body frame. The transformation $R_I^\top$ is therefore required; $v \Delta t_j$ cannot be used directly.

### 3.3 Joint Filter Update

After compensating motion within the window, Batch-LIO performs the following operations for the points in the batch:

- map nearest-neighbor search;
- local plane fitting;
- point-to-plane residual computation;
- Jacobian construction.

All valid measurements are then stacked, and a single EKF update is performed at the end of the window.

The main source of Batch-LIO’s speedup is therefore not a reduction in the number of points used for matching. It comes from:

1. reducing the number of filter updates;
2. reducing repeated filter computations;
3. merging many small tasks into larger point groups;
4. making KNN and plane fitting more suitable for OpenMP parallelism.

The tests showed that applying OpenMP directly to Point-LIO’s small point groups can make execution slower because thread-scheduling overhead exceeds the amount of useful computation. Batch grouping increases the number of points handled in each update, allowing OpenMP to produce a clearer benefit.

## 4. Current Limitations

The project still has several limitations:

1. Testing is based primarily on a limited number of rosbags, with insufficient data volume and scenario coverage.
2. Long-duration testing on a RoboMaster sentinel robot has not yet been completed.
3. The current data has no reliable trajectory ground truth. Results have only been compared with the Point-LIO baseline, without formal ATE or RPE evaluation.
4. Larger batch windows may make the filter unstable.

The current results therefore demonstrate the feasibility of batch updates and the scale of the potential compute-time reduction. They do not constitute complete accuracy validation or real-robot validation.

Testing on different LiDARs, compute platforms, and real robots is welcome. Problems and improvement ideas can be reported through GitHub Issues.

## 5. Future Work

The planned work is tracked in [GitHub Issue #9](https://github.com/Functionhx/Batch-LIO/issues/9).

### 5.1 CPU-Side Optimization

While retaining Batch-LIO’s batch-update method, selected optimizations from Small Point-LIO will be explored for the voxel map, memory management, and fixed-size measurement computation.

### 5.2 CUDA Acceleration

The first CUDA back end will target a discrete GPU on x86, with the GPU handling:

- voxel-map queries and updates;
- point-cloud nearest-neighbor search;
- plane matching and residual construction;
- parallel reduction of the information matrix and information vector.

The CPU will retain IMU state propagation and the small EKF solve. A CPU/GPU dispatch threshold will be evaluated according to batch size.

### 5.3 Map Representation and Robust Matching

Drawing on ideas from FR-LIO and FAR-LIO, planned experiments include a robot-centric voxel map, adaptive point-cloud density, robust matching thresholds, and sparse GICP, while preserving Batch-LIO’s batch-measurement semantics.

### 5.4 Jetson Deployment

After the x86 CUDA version has been validated, it will be ported to Jetson and evaluated for:

- sustained runtime latency;
- P50, P95, and P99 execution time;
- power consumption and temperature;
- memory use and thermal throttling;
- performance while LIO and TensorRT perception tasks run concurrently.

### 5.5 More Platforms and Data

Future work also includes ROS 2 Jazzy support and more complete trajectory-accuracy, stability, and performance testing on datasets with ground truth and on real RoboMaster robots.

All subsequent optimizations will retain the original Batch-LIO comparison path.

## 6. Open-Source Repository

Repository: [github.com/Functionhx/Batch-LIO](https://github.com/Functionhx/Batch-LIO)

The `main` branch currently contains the ROS 2 Humble version. The ROS 1 Noetic version is preserved under the `ros1-noetic` tag.

Testing with different LiDAR models, compute platforms, and real robots is welcome, as are Issues and pull requests.

## 7. References

[1] D. He, W. Xu, N. Chen, F. Kong, C. Yuan and F. Zhang, “Point-LIO: Robust High-Bandwidth Light Detection and Ranging Inertial Odometry,” _Advanced Intelligent Systems_, 2023.

[2] 张昊鹏，《高带宽轮式激光惯性里程计（Batch-LIWO）》，中国科学技术大学本科毕业设计。

[3] W. Xu and F. Zhang, “FAST-LIO: A Fast, Robust LiDAR-Inertial Odometry Package by Tightly-Coupled Iterated Kalman Filter,” _IEEE Robotics and Automation Letters_, 2021.

[4] W. Xu, Y. Cai, D. He, J. Lin and F. Zhang, “FAST-LIO2: Fast Direct LiDAR-Inertial Odometry,” _IEEE Transactions on Robotics_, 2022.

[5] HKU-MARS, Point-LIO: [github.com/hku-mars/Point-LIO](https://github.com/hku-mars/Point-LIO)

[6] ACE, Small Point-LIO: [github.com/Yancey2023/small_point_lio](https://github.com/Yancey2023/small_point_lio)

[7] J. Liu, Y. Zhang, X. Zhao and Z. He, “FR-LIO: Fast and Robust LiDAR-Inertial Odometry by Tightly-Coupled Iterated Kalman Smoother and Robocentric Voxels,” 2023.

[8] M. Leitenstern, M. Weinmann, P. Haft, T. Lasser, D. Kulmer and M. Lienkamp, “FAR-LIO: Enabling High-Speed Autonomy through Fast, Accurate, and Robust LiDAR-Inertial Odometry,” 2026.

---

The Chinese original was published on the [RoboMaster Community](https://bbs.robomaster.com/article/1936372?source=1) on July 22, 2026. The community edition is licensed under CC BY-NC-SA 4.0.
