---
layout: post
title: "【RM2026-LIO算法开源】Batch-LIO：批量更新加速 Point-LIO 最高 4.7 倍"
slug: batch-lio
date: 2026-07-22 22:16:07 +0800
published: true
description: Batch-LIO 将相邻约 1 ms 内的激光点批量更新，在当前哨兵 Livox rosbag 测试中将每帧平均计算耗时降低至 Point-LIO 式更新的约 1/3.5 至 1/4.7。
permalink: /blog/2026/batch-lio/
lang: zh
locale: zh
translation_key: post-batch-lio
kind: writing
tags: [LIO, 机器人, 开源]
categories: [技术]
related_posts: false
giscus_comments: true
---

## 一、项目简介

Point-LIO 采用 point-wise 的更新方式，在每个采样时刻更新系统状态。这样的设计可以获得较高的里程计输出频率，并天然避免传统帧式 LIO 中由整帧点云累积造成的运动畸变。

但另一方面，大量细粒度的点云匹配和滤波更新也会带来较高的计算开销，系统需要频繁进行近邻搜索、平面拟合、残差构建和 EKF 更新，消耗了较多的计算资源。

Batch-LIO 参考中国科学技术大学张昊鹏学长本科毕业设计 Batch-LIWO 中的批量更新方法，对 Point-LIO 的更新粒度进行了修改：

> 将相邻约 1 ms 内的激光点组成一个 batch，完成窗口内运动补偿后，统一执行一次滤波更新。

目前项目已经提供：

- ROS 1 Noetic 版本；
- ROS 2 Humble 版本；
- Point-LIO 与 Batch-LIO 的 A/B 对照开关；
- batch 内去畸变单元测试；
- ROS 2 rosbag 转换、运行和消融测试脚本。

项目地址：[github.com/Functionhx/Batch-LIO](https://github.com/Functionhx/Batch-LIO)

## 二、测试结果

目前实验在哨兵 Livox rosbag 上进行，测试平台为 x86 计算机，操作系统为 Ubuntu 22.04。

在相同数据和参数下，通过设置：

```yaml
batch_dt: 0.0
```

运行 Point-LIO 式细粒度更新；设置：

```yaml
batch_dt: 0.001
```

运行 1 ms Batch-LIO。

ROS 2 Humble 下的测试结果如下：

| 数据包      | Point-LIO 式更新 | Batch-LIO 1 ms | 加速比 |
| ----------- | ---------------: | -------------: | -----: |
| quick-shack |         12.42 ms |        3.51 ms |   3.5× |
| outdoor_run |          2.56 ms |        0.54 ms |   4.7× |

这里统计的是每帧点云对应的平均计算耗时。

在当前测试数据和参数下，Batch-LIO 输出的轨迹与 Point-LIO 基线比较接近，没有观察到明显的轨迹退化。

对不同 batch 时间窗口进行测试后可以看到：随着时间窗口增大，滤波更新次数继续减少，计算耗时也会下降。但较大的时间窗口会增加运动补偿误差，并可能影响滤波器稳定性。目前建议将 `batch_dt` 设置在 1～2 ms。

## 三、核心原理

### 1. 时间窗口分组

Point-LIO 的算法设计是逐点更新。实际代码会将时间戳相同的少量点组合起来，但点组通常仍然很小，因此每帧需要执行大量细粒度更新。

Batch-LIO 不再只按照完全相同的时间戳分组，而是将相邻约 1 ms 内的点划分到同一个窗口：

```text
Point-LIO：

[t₀] [t₁] [t₂] [t₃] [t₄] ...
 ↓    ↓    ↓    ↓    ↓
多次小规模更新

Batch-LIO：

[        t₀ ～ tₙ，约 1 ms        ]
                  ↓
             一次联合更新
```

这样可以显著减少每帧执行 EKF 更新的次数。

### 2. Batch 内运动补偿

同一个 batch 内的点并不是在同一时刻采集的，因此不能直接将它们当作同时刻点云进行匹配。

Batch-LIO 将窗口内的点补偿到最后一个点的采样时刻。

对于第 $j$ 个点，其相对于窗口末端的时间偏移为：

$$
\Delta t_j = t_j - t_{\mathrm{last}}, \qquad \Delta t_j \le 0
$$

根据当前滤波状态中的角速度和线速度，计算旋转补偿：

$$
R_j = \operatorname{Exp}(\omega \Delta t_j)
$$

计算平移补偿：

$$
T_j = R_I^\top v \Delta t_j
$$

最终得到补偿后的激光点：

$$
p'_j = R_j p_j + T_j
$$

这里需要注意，状态中的线速度 $v$ 位于世界坐标系，而激光点的运动补偿在机体坐标系中进行，因此需要通过 $R_I^\top$ 完成坐标系转换，不能直接使用 $v \Delta t_j$。

### 3. 联合滤波更新

完成窗口内运动补偿后，对 batch 中的点分别进行：

- 地图近邻搜索；
- 局部平面拟合；
- 点到平面残差计算；
- Jacobian 构建。

随后将所有有效量测堆叠起来，在窗口末端统一执行一次 EKF 更新。

因此，Batch-LIO 的主要加速来源并不是减少参与匹配的点数，而是：

1. 减少滤波更新次数；
2. 减少重复的滤波器计算；
3. 将大量小规模任务合并为较大的点组；
4. 使 KNN 和平面拟合更适合使用 OpenMP 并行。

测试中发现，直接在 Point-LIO 的小点组上使用 OpenMP 反而可能变慢，因为线程调度开销超过了实际计算量。经过 batch 分组后，每次处理的点数增加，OpenMP 才能获得比较明显的收益。

## 四、项目局限性

当前项目仍然存在以下不足：

1. 测试主要基于有限的 rosbag，数据量和场景覆盖不足；
2. 尚未在 RoboMaster 哨兵机器人上进行长期运行测试；
3. 当前数据没有可靠的轨迹真值，只与 Point-LIO 基线进行了对比，尚未完成正式的 ATE、RPE 精度评价；
4. 较大的 batch 时间窗口可能导致滤波器不稳定。

因此，目前结果主要用于验证批量更新方法是否可行，以及能够带来多大的计算加速，还不能代表已经完成了充分的精度和实车验证。

欢迎有条件的同学帮忙在不同雷达、计算平台或真实机器人上测试。遇到问题或者有改进想法，可以直接在 GitHub Issues 中反馈。

## 五、Future Work

项目后续工作已经整理到 [GitHub Issue #9](https://github.com/Functionhx/Batch-LIO/issues/9)。

目前计划包括：

### 1. CPU 侧优化

在保留 Batch-LIO 批量更新方式的基础上，选择性吸收 Small Point-LIO 在体素地图、内存管理和固定尺寸量测计算方面的优化。

### 2. CUDA 加速

首先在 x86 独立显卡上开发 CUDA 后端，使 GPU 负责：

- 体素地图查询与更新；
- 点云近邻搜索；
- 平面匹配和残差构建；
- 信息矩阵与信息向量的并行归约。

CPU 保留 IMU 状态传播和小尺寸 EKF 求解，并根据 batch 大小评估 CPU/GPU 分流阈值。

### 3. 地图与鲁棒匹配

参考 FR-LIO、FAR-LIO 等工作的思路，实验机器人中心体素地图、自适应点云密度、鲁棒匹配阈值和稀疏 GICP，同时保留 Batch-LIO 的批量量测语义。

### 4. Jetson 部署

在 x86 CUDA 版本验证完成后，迁移至 Jetson 平台，测试：

- 持续运行延迟；
- P50、P95、P99 耗时；
- 功耗和温度；
- 内存占用与降频；
- LIO 与 TensorRT 感知任务并发运行时的性能。

### 5. 更多平台与数据测试

后续还计划支持 ROS 2 Jazzy，并在带真值数据集和 RoboMaster 实车上完成更充分的轨迹精度、稳定性和性能测试。

所有后续优化都将保留原版 Batch-LIO 对照路径。

## 六、开源地址

项目仓库：[github.com/Functionhx/Batch-LIO](https://github.com/Functionhx/Batch-LIO)

目前 `main` 分支为 ROS 2 Humble 版本，ROS 1 Noetic 版本保留在 `ros1-noetic` tag 中。

欢迎感兴趣的同学使用不同型号雷达、计算平台和真实机器人进行测试，也欢迎提交 Issue 或 PR。

## 七、参考文献

[1] D. He, W. Xu, N. Chen, F. Kong, C. Yuan and F. Zhang, “Point-LIO: Robust High-Bandwidth Light Detection and Ranging Inertial Odometry,” _Advanced Intelligent Systems_, 2023.

[2] 张昊鹏，《高带宽轮式激光惯性里程计（Batch-LIWO）》，中国科学技术大学本科毕业设计。

[3] W. Xu and F. Zhang, “FAST-LIO: A Fast, Robust LiDAR-Inertial Odometry Package by Tightly-Coupled Iterated Kalman Filter,” _IEEE Robotics and Automation Letters_, 2021.

[4] W. Xu, Y. Cai, D. He, J. Lin and F. Zhang, “FAST-LIO2: Fast Direct LiDAR-Inertial Odometry,” _IEEE Transactions on Robotics_, 2022.

[5] HKU-MARS, Point-LIO: [github.com/hku-mars/Point-LIO](https://github.com/hku-mars/Point-LIO)

[6] ACE, Small Point-LIO: [github.com/Yancey2023/small_point_lio](https://github.com/Yancey2023/small_point_lio)

[7] J. Liu, Y. Zhang, X. Zhao and Z. He, “FR-LIO: Fast and Robust LiDAR-Inertial Odometry by Tightly-Coupled Iterated Kalman Smoother and Robocentric Voxels,” 2023.

[8] M. Leitenstern, M. Weinmann, P. Haft, T. Lasser, D. Kulmer and M. Lienkamp, “FAR-LIO: Enabling High-Speed Autonomy through Fast, Accurate, and Robust LiDAR-Inertial Odometry,” 2026.

---

本文于 2026 年 7 月 22 日发布于 [RoboMaster 社区](https://bbs.robomaster.com/article/1936372?source=1)；社区版本采用 CC BY-NC-SA 4.0 许可协议。
