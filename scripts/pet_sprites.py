#!/usr/bin/env python3
"""把画师交付的宠物动作帧导入网站：每个状态拼成一张横向 WebP 序列帧条，并生成 / 更新 pet.json。

    python3 scripts/pet_sprites.py <宠物 id> <素材文件夹> --credit "形象：@画师" [--license "CC BY-NC-SA 4.0"] [--costume <换装 id>]

素材文件夹里，每个状态是一个子文件夹（透明 PNG / WebP 序列，按文件名排序），或一个动图文件
（GIF / APNG / 动态 WebP），名字就是状态名：idle/、walk/、think.gif ……

所有帧必须同一画布尺寸、背景透明。脚本把画布等比缩放进 --frame 大小（默认 256）的正方形、底边居中对齐，
所以画师那边各动作的基准线一致，导入后也一致。需要 Pillow（pip install pillow）。

也可以只给一张「动作表」：一张图里按格子排好各个动作（每格一个姿势），纯色背景也行（自动抠掉）：

    python3 scripts/pet_sprites.py deepseek 大肥鱼动作表.png --sheet 3x3 --credit "形象：…"

默认格子顺序（从左到右、从上到下）：idle talk think / happy failed sleep / wave waiting walk，
可以用 --states 改。每格一个静止姿势，网页用 CSS 给它加上呼吸、跳跃、摇晃等动作。抠背景需要 numpy。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageSequence
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：pip install pillow")

ROOT = Path(__file__).resolve().parents[1]
PETS = ("f01", "deepseek", "claude", "chatgpt", "gemini")
FRAME_SUFFIXES = {".png", ".webp"}
ANIMATED_SUFFIXES = {".gif", ".png", ".apng", ".webp"}
STATE_NAME = re.compile(r"^[a-z][a-z0-9-]*$")
PHASE_ONE = ("idle", "walk", "wave", "think", "talk", "waiting", "happy", "failed", "sleep")
# 默认播放速度与是否循环（导入后可以直接改 pet.json）。
TIMING = {
    "idle": (6, True),
    "walk": (10, True),
    "wave": (8, False),
    "think": (8, True),
    "talk": (8, True),
    "waiting": (5, True),
    "happy": (10, False),
    "failed": (8, False),
    "sleep": (3, True),
    "drag": (12, True),
    "float": (6, True),
    "fall": (10, False),
    "land": (10, False),
    "surprised": (10, False),
    "unfold": (8, True),
    "eat": (10, True),
    "dive": (8, False),
    "bubble": (8, True),
    "read": (6, True),
    "tea": (6, False),
    "write": (8, True),
    "note": (8, True),
    "bulb": (8, False),
    "cards": (10, True),
    "split": (8, False),
    "swap": (8, False),
    "shimmer": (8, False),
}
BUDGET_BYTES = 300 * 1024
SHEET_ORDER = ("idle", "talk", "think", "happy", "failed", "sleep", "wave", "waiting", "walk")


def background_color(image: Image.Image) -> tuple[int, int, int] | None:
    """动作表四条边上最常见的颜色；边上本来就透明时返回 None（不用抠）。"""
    rgba = image.convert("RGBA")
    w, h = rgba.size
    border = [rgba.getpixel((x, y)) for x in range(0, w, max(1, w // 64)) for y in (0, h - 1)]
    border += [rgba.getpixel((x, y)) for y in range(0, h, max(1, h // 64)) for x in (0, w - 1)]
    if sum(1 for px in border if px[3] < 16) > len(border) // 2:
        return None
    counts: dict[tuple[int, int, int], int] = {}
    for r, g, b, _a in border:
        key = (r // 8 * 8, g // 8 * 8, b // 8 * 8)
        counts[key] = counts.get(key, 0) + 1
    return max(counts, key=counts.get)


def remove_background(image: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    """按颜色距离抠掉纯色背景，边缘渐变透明；绿幕 / 蓝幕会顺便去掉边缘的反色。"""
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        sys.exit("抠纯色背景需要 numpy：pip install numpy（或直接导出透明背景）")
    rgb = np.asarray(image.convert("RGB")).astype(np.float32)
    key = np.array(color, dtype=np.float32)
    distance = np.sqrt(((rgb - key) ** 2).sum(axis=-1))
    alpha = np.clip((distance - 48) / 72, 0, 1)
    channel = int(np.argmax(key))
    if key[channel] > 160 and key[channel] - np.delete(key, channel).max() > 80:
        others = np.delete(rgb, channel, axis=-1).max(axis=-1)
        rgb[..., channel] = np.where(alpha < 1, np.minimum(rgb[..., channel], others), rgb[..., channel])
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def cut_sheet(path: Path, grid: str, names: list[str]) -> dict[str, list[Image.Image]]:
    """把一张动作表按格子切开，每格去背景、裁到人物，再放回同一张画布（底边居中），保证大小与基准线一致。"""
    try:
        cols, rows = (int(n) for n in grid.lower().split("x"))
    except ValueError:
        sys.exit("--sheet 的格式是 列x行，例如 3x3")
    sheet = Image.open(path).convert("RGBA")
    color = background_color(sheet)
    if color:
        print(f"  背景色 #{color[0]:02x}{color[1]:02x}{color[2]:02x}，自动抠掉")
        sheet = remove_background(sheet, color)
    cell_w, cell_h = sheet.width // cols, sheet.height // rows
    if len(names) > cols * rows:
        sys.exit(f"{len(names)} 个状态放不进 {cols}×{rows} 的格子")
    figures: dict[str, Image.Image] = {}
    for index, name in enumerate(names):
        col, row = index % cols, index // cols
        cell = sheet.crop((col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h))
        bbox = cell.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
        if not bbox:
            print(f"  跳过 {name}：第 {row + 1} 行第 {col + 1} 格是空的", file=sys.stderr)
            continue
        figures[name] = cell.crop(bbox)
    if not figures:
        sys.exit("动作表里没有找到任何人物")
    width = max(f.width for f in figures.values())
    height = max(f.height for f in figures.values())
    canvas = max(width, height)
    margin = round(canvas * 0.08)
    states = {}
    for name, figure in figures.items():
        frame = Image.new("RGBA", (canvas + 2 * margin, canvas + margin), (0, 0, 0, 0))
        frame.paste(figure, ((frame.width - figure.width) // 2, frame.height - figure.height), figure)
        states[name] = [frame]
    return states


def load_state(path: Path) -> list[Image.Image]:
    if path.is_dir():
        files = sorted(p for p in path.iterdir() if p.suffix.lower() in FRAME_SUFFIXES and not p.name.startswith("."))
        return [Image.open(p).convert("RGBA") for p in files]
    with Image.open(path) as image:
        return [frame.convert("RGBA") for frame in ImageSequence.Iterator(image)]


def collect(source: Path) -> dict[str, list[Image.Image]]:
    states: dict[str, list[Image.Image]] = {}
    for entry in sorted(source.iterdir()):
        if entry.name.startswith("."):
            continue
        name = entry.stem.lower() if entry.is_file() else entry.name.lower()
        if entry.is_file() and entry.suffix.lower() not in ANIMATED_SUFFIXES:
            continue
        if not STATE_NAME.match(name):
            print(f"跳过 {entry.name}：状态名只能用小写字母、数字和连字符", file=sys.stderr)
            continue
        frames = load_state(entry)
        if frames:
            states[name] = frames
    return states


def check(states: dict[str, list[Image.Image]]) -> tuple[int, int]:
    sizes = {frame.size for frames in states.values() for frame in frames}
    if len(sizes) != 1:
        detail = "、".join(f"{w}×{h}" for w, h in sorted(sizes))
        sys.exit(f"所有帧必须是同一画布尺寸（现在有 {detail}）。请让画师按同一画布导出，基准线才会一致。")
    for name, frames in states.items():
        if all(frame.getchannel("A").getextrema()[0] == 255 for frame in frames):
            sys.exit(f"{name}：背景不透明。请导出透明背景的 PNG / WebP。")
    return sizes.pop()


def occupancy(states: dict[str, list[Image.Image]], canvas: tuple[int, int]) -> float:
    box = None
    for frames in states.values():
        for frame in frames:
            bbox = frame.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
            if not bbox:
                continue
            box = bbox if box is None else (min(box[0], bbox[0]), min(box[1], bbox[1]), max(box[2], bbox[2]), max(box[3], bbox[3]))
    if not box:
        return 0.0
    return max((box[2] - box[0]) / canvas[0], (box[3] - box[1]) / canvas[1])


def fit(frame: Image.Image, size: int) -> Image.Image:
    scale = min(size / frame.width, size / frame.height)
    resized = frame.resize((max(1, round(frame.width * scale)), max(1, round(frame.height * scale))), Image.LANCZOS)
    cell = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cell.paste(resized, ((size - resized.width) // 2, size - resized.height), resized)
    return cell


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pet", choices=PETS)
    parser.add_argument("source", type=Path)
    parser.add_argument("--credit", help="面板里显示的署名，例如「形象：@画师名」（同人形象必须署名）")
    parser.add_argument("--license", help="形象的许可，例如「CC BY-NC-SA 4.0」，会和署名一起显示")
    parser.add_argument("--costume", help="把这批帧登记为换装（如 claude-uniform），不覆盖默认形象")
    parser.add_argument("--frame", type=int, default=256, help="单帧边长（默认 256，网页按一半显示）")
    parser.add_argument("--quality", type=int, default=90, help="WebP 质量（默认 90）")
    parser.add_argument("--lossless", action="store_true", help="无损 WebP（文件更大）")
    parser.add_argument("--sheet", metavar="列x行", help="素材是一张动作表，按格子切开（例如 3x3）")
    parser.add_argument("--states", help=f"动作表里各格的状态，逗号分隔（默认 {','.join(SHEET_ORDER)}）")
    args = parser.parse_args()

    if args.costume and not STATE_NAME.match(args.costume):
        sys.exit("换装 id 只能用小写字母、数字和连字符")
    if args.sheet:
        names = [n.strip() for n in (args.states or ",".join(SHEET_ORDER)).split(",") if n.strip()]
        bad = [n for n in names if not STATE_NAME.match(n)]
        if bad:
            sys.exit(f"状态名只能用小写字母、数字和连字符：{', '.join(bad)}")
        states = cut_sheet(args.source.expanduser(), args.sheet, names)
    else:
        states = collect(args.source.expanduser())
    if not states:
        sys.exit(f"{args.source} 里没有找到任何状态（子文件夹或动图）")
    canvas = check(states)
    filled = occupancy(states, canvas)

    pet_dir = ROOT / "assets" / "pet" / args.pet
    base = f"sprites/{args.costume}/" if args.costume else "sprites/"
    out_dir = pet_dir / base
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = pet_dir / "pet.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest.setdefault("id", args.pet)
    manifest["version"] = int(manifest.get("version", 0)) + 1
    manifest["frame"] = {"width": args.frame, "height": args.frame}
    manifest.setdefault("display", {"width": args.frame // 2, "height": args.frame // 2})
    manifest.setdefault("base", "sprites/")
    if args.credit:
        manifest["credit"] = args.credit
    if args.license:
        manifest["license"] = args.license
    if not manifest.get("credit"):
        print("  提醒：还没有署名（--credit），登记前必须补上", file=sys.stderr)
    manifest.setdefault("states", {})

    total = 0
    print(f"{args.pet}{' / ' + args.costume if args.costume else ''}：原画布 {canvas[0]}×{canvas[1]}，人物最大占画布 {filled:.0%}")
    if filled and not 0.7 <= filled <= 0.95:
        print("  提醒：人物建议占画布 80–88%（太小显得远，太大容易被裁）", file=sys.stderr)
    for name, frames in sorted(states.items()):
        strip = Image.new("RGBA", (args.frame * len(frames), args.frame), (0, 0, 0, 0))
        for index, frame in enumerate(frames):
            strip.paste(fit(frame, args.frame), (index * args.frame, 0))
        target = out_dir / f"{name}.webp"
        options = {"lossless": True} if args.lossless else {"quality": args.quality, "alpha_quality": 100}
        strip.save(target, "WEBP", method=6, **options)
        size = target.stat().st_size
        total += size
        table = manifest.setdefault("costumes", {}).setdefault(args.costume, {"base": base}).setdefault("states", {}) if args.costume else manifest["states"]
        fps, loop = TIMING.get(name, (8, True))
        previous = table.get(name, {})
        table[name] = {"file": f"{name}.webp", "frames": len(frames), "fps": previous.get("fps", fps), "loop": previous.get("loop", loop)}
        print(f"  {name:<10} {len(frames):>2} 帧  {size / 1024:6.1f} KB")
    if args.costume:
        manifest["costumes"][args.costume]["base"] = base
        missing = sorted(set(manifest["states"]) - set(states))
        if missing:
            print(f"  提醒：换装缺少这些状态，换装时这些动作会显示默认衣服：{', '.join(missing)}", file=sys.stderr)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"  合计 {total / 1024:.1f} KB" + ("（超过第一阶段建议的 300 KB）" if total > BUDGET_BYTES else ""))
    missing = [state for state in PHASE_ONE if state not in manifest["states"]]
    if missing and not args.costume:
        print(f"  第一阶段还缺：{', '.join(missing)}（缺的会退回最接近的动作）")
    if "idle" not in manifest["states"]:
        print("  必须有 idle，否则网页不会使用这套形象", file=sys.stderr)
    print(f"写入 {manifest_path.relative_to(ROOT)}")
    print(f"下一步：在 _data/pets/{args.pet}.yml 写 sprites: /assets/pet/{args.pet}/pet.json，并放好 assets/pet/{args.pet}/LICENSE.md")


if __name__ == "__main__":
    main()
