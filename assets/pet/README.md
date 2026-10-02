# 网站宠物的形象素材

五只宠物，一次只出现一只，访客可以在面板里「换一只」：

| id         | 名字（暂定） | 自家                                 | 设定母版                                                                   |
| ---------- | ------------ | ------------------------------------ | -------------------------------------------------------------------------- |
| `f01`      | ƒ-01         | 本站原住民（原创，不用任何公司标志） | [`f01/source/character-brief.md`](f01/source/character-brief.md)           |
| `deepseek` | 大肥鱼       | DeepSeek                             | [`deepseek/source/character-brief.md`](deepseek/source/character-brief.md) |
| `claude`   | 陶陶         | Anthropic                            | [`claude/source/character-brief.md`](claude/source/character-brief.md)     |
| `chatgpt`  | 薄荷         | OpenAI                               | [`chatgpt/source/character-brief.md`](chatgpt/source/character-brief.md)   |
| `gemini`   | 双双         | Google                               | [`gemini/source/character-brief.md`](gemini/source/character-brief.md)     |

台词与性格在 `_data/pets/<id>.yml`，大脑里的人设在 `pet-brain/persona.mjs`。授权形象登记之前，网站用内置的占位形象
（`?pet=on` 预览），对访客不出现。

## 目录

```text
assets/pet/<id>/
├── source/        # 设定表、三视图、表情、色板、PSD——不进网站构建（_config.yml exclude）
├── sprites/       # 网页实际加载：每个状态一张横向序列帧条（WebP）
├── pet.json       # 形象清单（scripts/pet_sprites.py 生成）
└── LICENSE.md     # 授权记录（站长上传；登记形象时 validate_content.py 要求它存在）
```

## 从画师的素材到网页（一条命令）

把画师交付的透明 PNG 序列按状态分文件夹放好（文件名按帧顺序排序即可），或每个状态一个透明 GIF / APNG / WebP 动图：

```text
~/Downloads/claude-frames/
├── idle/0001.png 0002.png …
├── walk/…
├── think.gif
└── …
```

```bash
pip install pillow
python3 scripts/pet_sprites.py claude ~/Downloads/claude-frames --credit "形象：@画师名"
# 换装（整套帧放在另一个文件夹）：
python3 scripts/pet_sprites.py deepseek ~/Downloads/whale-claude-uniform --costume claude-uniform
```

脚本会：检查每帧同尺寸、背景透明；把所有帧统一缩放到 256×256 画布（等比、底边对齐，保证所有动作基准线一致）；
每个状态拼成一张 WebP 横条写进 `assets/pet/<id>/sprites/`；生成 / 更新 `pet.json`；报告每张图和总大小
（第一阶段每只建议 ≤ 300 KB）。然后在 `_data/pets/<id>.yml` 写 `sprites: /assets/pet/<id>/pet.json`，
并放好 `assets/pet/<id>/LICENSE.md`，这只宠物就会对访客出现。

## pet.json

```json
{
  "id": "claude",
  "version": 1,
  "frame": { "width": 256, "height": 256 },
  "display": { "width": 128, "height": 128 },
  "credit": "形象：@画师名",
  "base": "sprites/",
  "states": {
    "idle": { "file": "idle.webp", "frames": 8, "fps": 6, "loop": true },
    "happy": { "file": "happy.webp", "frames": 8, "fps": 10, "loop": false }
  },
  "costumes": {
    "claude-uniform": { "base": "sprites/claude-uniform/", "states": { "idle": { "file": "idle.webp", "frames": 8, "fps": 6 } } }
  }
}
```

- `display` 省略时按帧尺寸的一半显示（帧图是 2 倍图）；手机上再缩到 74%。
- 缺的状态按 `pet.js` 的 `FALLBACK` 退回最接近的那个（`wave` → `happy`、`read` → `think` …），最后退回 `idle`。
- `loop: false` 只播一遍并停在最后一帧。
- 换装有自己的 `states`；换装里没画的动作显示默认衣服的那一套。

## 状态

**第一阶段（每只都要）：** `idle` 待机呼吸眨眼 6–8 帧 · `walk` 移动 8 · `wave` 打招呼 6–8 · `think` 思考 8–12 ·
`talk` 说话 4–6 · `waiting` 等输入 6–8 · `happy` 开心 8–12 · `failed` 出错 6–8 · `sleep` 睡觉 6–8。

**招牌动作（各自的，见设定母版）：** ƒ-01 `unfold` · 大肥鱼 `eat` `dive` `bubble` · 陶陶 `read` `tea` `write` ·
薄荷 `note` `bulb` `cards` · 双双 `split` `swap` `shimmer`。

**第二阶段：** `drag` 被拎起 · `fall` / `float` 掉落 · `land` 落地 · `surprised` · `hide` …

## 规格

- 单帧画布 256×256（母版至少 2048），透明背景，人物占画布约 80–88%。
- 所有动作底部基准线一致；默认朝左，向右走时网页镜像；阴影不要画进人物（网页自己画）。
- 交付透明 PNG 序列或动图，不要只给 GIF 成品（GIF 的半透明边缘会发灰；脚本能读，但效果差）。

## 授权记录（LICENSE.md）

每只一份，由站长上传。建议写明：作者与授权方、授权日期与原文（截图或链接）、是否允许公开展示、修改、
动画化、AI 辅助补帧、放进公开 GitHub 仓库、他人再分发、商业使用；角色身上的公司标志（Anthropic 图标、
OpenAI Blossom、Gemini 星形、DeepSeek 鲸鱼）的使用许可——**改色（如 Blossom 发卡）属于修改，需要授权里明确允许**。

网站上只写「同人角色 · 形象已获授权」和画师署名；不写「官方」「赞助」「合作」，除非有书面依据（见 AGENTS.md）。
