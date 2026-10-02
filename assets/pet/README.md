# ƒ-01 的形象素材

宠物的形象是授权使用的「蓝色大肥鱼」。素材放在 `assets/pet/sprites/`，在 `_data/pet.yml`
的 `sprites` 里登记后，`assets/js/pet.js` 就会用它替换内置的占位鲸鱼。

## 授权记录

使用前把下面这些写进 `assets/pet/LICENSE.md`（与 `assets/img/social/README.md` 记录品牌图标的做法一致）：

- 形象作者与授权方、联系方式或主页；
- 授权范围：在本网站展示、拆分为动画帧、必要的修改（表情、尺寸、配色）；
- 授权日期与授权原文（截图或链接）；
- 工服上 Anthropic 图标的使用许可来源（图标请用官方原件，不要重绘）。

网站上会在宠物面板里注明形象作者。

## 序列帧格式

每个状态一张**横向序列帧条**（透明背景的 WebP 或 PNG），所有帧等宽、从左到右排列：

```yaml
# _data/pet.yml
sprites:
  base: /assets/pet/sprites/
  width: 88 # 桌面上显示的宽度（px），手机上自动缩到 74%
  height: 96 # 显示高度，按素材比例填
  credit: 形象：@作者名（授权使用）
  states:
    idle: { file: idle.webp, frames: 8, fps: 8 }
    talk: { file: talk.webp, frames: 4, fps: 10 }
    think: { file: think.webp, frames: 6, fps: 8 }
    happy: { file: happy.webp, frames: 6, fps: 12 }
    sleep: { file: sleep.webp, frames: 4, fps: 3 }
    confused: { file: confused.webp, frames: 4, fps: 6 }
    drag: { file: drag.webp, frames: 4, fps: 12 }
    float: { file: float.webp, frames: 6, fps: 6 }
```

- 缺少的状态会退回 `idle`；`loop: false` 表示只播一遍并停在最后一帧。
- 帧图建议按显示尺寸的 2 倍导出（高分屏清晰），单张序列帧条控制在 100 KB 以内。
- 分层 PSD 也可以：拆成头、眼睛、身体、尾巴后，用 CSS 做眨眼、呼吸等分层动画，需要单独实现。

素材和 `sprites` 配好之后，才能把 `_config.yml` 的 `pet.enabled` 打开（`validate_content.py` 会检查）。
