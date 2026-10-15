#!/usr/bin/env python3
"""Generate the terminal app icon and per-platform assets source image.

Usage:
  python3 scripts/generate-icon.py [--output PATH] [--palette NAME]

Palettes: aurora (default), violet, phosphor. Renders a 1024x1024 RGBA
source image (Big Sur rounded tile with a glowing terminal prompt) that
`tauri icon` turns into icns/ico/png assets. `--previews DIR` renders all
palettes at 512px for comparison; `--gallery DIR` renders every palette at
every size in GALLERY_SIZES and writes an index.html comparison page.
"""

import argparse
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 1024
MARGIN = 100
RADIUS = 184
LINE_WIDTH = 54
GALLERY_SIZES = (512, 256, 128, 64, 32)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def diagonal_gradient(size, top_left, bottom_right):
    base = Image.linear_gradient("L").resize((size * 2, size * 2)).rotate(45, expand=False)
    box = (
        (base.width - size) // 2,
        (base.height - size) // 2,
        (base.width - size) // 2 + size,
        (base.height - size) // 2 + size,
    )
    mask = base.crop(box).resize((size, size))
    top = Image.new("RGB", (size, size), top_left)
    bottom = Image.new("RGB", (size, size), bottom_right)
    return Image.composite(bottom, top, mask)


PALETTES = {
    "aurora": {
        "gradient": ((28, 29, 66), (9, 62, 76)),
        "accent": (95, 242, 200),
        "sheen": 14,
        "desc": "深蓝 → 青绿渐变，薄荷绿提示符。冷峻、贴近终端荧光屏观感",
    },
    "violet": {
        "gradient": ((38, 31, 56), (74, 48, 106)),
        "accent": (245, 245, 255),
        "sheen": 12,
        "desc": "紫罗兰渐变，纯白提示符。更柔和、偏现代工具类 App 的调性",
    },
    "phosphor": {
        "gradient": ((10, 26, 19), (16, 46, 34)),
        "accent": (255, 200, 87),
        "sheen": 12,
        "desc": "深墨绿渐变，琥珀色提示符。复刻老式 CRT 磷光屏的复古味道",
    },
}


def rounded_tile(size):
    scale = size / SIZE
    tile = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(tile)
    inset = MARGIN * scale
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=round(RADIUS * scale),
        fill=255,
    )
    return tile


def draw_prompt(layer_size):
    """Draw the `>` chevron and cursor block on a transparent layer."""
    layer = Image.new("RGBA", (layer_size, layer_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    scale = layer_size / SIZE
    width = max(1, round(LINE_WIDTH * scale))

    start = (296 * scale, 352 * scale)
    apex = (424 * scale, 502 * scale)
    end = (296 * scale, 652 * scale)
    radius = width / 2

    draw.line([start, apex], fill=(255, 255, 255, 255), width=width, joint="curve")
    # Pillow lines have no round caps; add explicit round joints and caps.
    for point in (start, apex, end):
        draw.ellipse(
            (point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius),
            fill=(255, 255, 255, 255),
        )
    draw.line([apex, end], fill=(255, 255, 255, 255), width=width, joint="curve")

    cursor = (512 * scale, 596 * scale, 736 * scale, 650 * scale)
    draw.rounded_rectangle(cursor, radius=round(27 * scale), fill=(255, 255, 255, 255))
    return layer


def paint_prompt(layer, color):
    """Fill every opaque pixel of the prompt layer with the accent color."""
    alpha = layer.getchannel("A")
    solid = Image.new("RGBA", layer.size, color + (255,))
    solid.putalpha(alpha)
    return solid


def render(palette_name, size=SIZE):
    palette = PALETTES[palette_name]
    tile = rounded_tile(size)
    gradient = diagonal_gradient(size, *palette["gradient"]).convert("RGBA")
    gradient.putalpha(tile)

    # Soft top sheen for depth, masked to the tile.
    sheen_mask = Image.radial_gradient("L").resize((size, size))
    sheen_mask = ImageChops.subtract(sheen_mask.point(lambda v: 255 - v), tile.point(lambda v: 255 - v))
    sheen = Image.new("RGBA", (size, size), (255, 255, 255, palette["sheen"]))
    sheen.putalpha(ImageChops.multiply(sheen_mask, tile.point(lambda v: v * palette["sheen"] // 255)))
    icon = Image.alpha_composite(gradient, sheen)

    # Inner highlight stroke on the tile edge.
    scale = size / SIZE
    stroke = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(stroke).rounded_rectangle(
        (MARGIN * scale + 2, MARGIN * scale + 2, size - MARGIN * scale - 2, size - MARGIN * scale - 2),
        radius=round(RADIUS * scale) - 2,
        outline=(255, 255, 255, 28),
        width=2,
    )
    icon = Image.alpha_composite(icon, stroke)

    # Glowing terminal prompt: a soft single halo plus the crisp shape.
    prompt_mask = draw_prompt(size)
    accent = palette["accent"]
    prompt = paint_prompt(prompt_mask, accent)
    halo = prompt.filter(ImageFilter.GaussianBlur(round(size / SIZE * 26)))
    halo.putalpha(halo.getchannel("A").point(lambda v: v * 55 // 100))
    for layer in (halo, prompt):
        icon = Image.alpha_composite(icon, layer)

    if size != SIZE:
        icon = icon.resize((size, size), Image.LANCZOS)
    return icon


GALLERY_STYLE = """
      :root {
        --bg: #f6f7f9; --panel: #ffffff; --border: #e3e6ea;
        --text: #1b1f24; --muted: #6b7280;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 40px 32px 64px; background: var(--bg); color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
          "Hiragino Sans GB", "Microsoft YaHei", sans-serif; line-height: 1.6;
      }
      .wrap { max-width: 1080px; margin: 0 auto; }
      h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
      p.lead { margin: 0 0 32px; color: var(--muted); font-size: 14px; }
      .heroes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
      .card {
        background: var(--panel); border: 1px solid var(--border);
        border-radius: 14px; padding: 20px; text-align: center;
      }
      .card.hero img { width: 200px; height: 200px; }
      .name { font-size: 15px; font-weight: 600; margin-top: 14px; }
      .desc { font-size: 12.5px; color: var(--muted); margin-top: 4px; min-height: 56px; }
      .swatches { display: flex; justify-content: center; gap: 6px; margin-top: 12px; }
      .swatch { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(0,0,0,.08); }
      h2 { font-size: 15px; margin: 40px 0 14px; font-weight: 600; }
      .strip {
        background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
        padding: 18px 20px; display: flex; align-items: flex-end; gap: 28px;
        flex-wrap: wrap; margin-bottom: 14px;
      }
      .strip .label { font-size: 12.5px; color: var(--muted); width: 92px; flex: none; }
      .strip figure { margin: 0; text-align: center; }
      .strip img { display: block; }
      .strip figcaption { font-size: 11px; color: var(--muted); margin-top: 8px; }
      .stage {
        background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
        padding: 18px 20px; display: flex; gap: 32px; flex-wrap: wrap; align-items: center;
      }
      .dock { border-radius: 18px; padding: 18px 20px; display: flex; align-items: flex-end; gap: 16px; }
      .dock.light { background: #eceef1; border: 1px solid #dcdfe4; }
      .dock.dark { background: #1b1f24; border: 1px solid #2b3037; }
      .dock .tag { font-size: 11px; opacity: .7; }
      .dock.light .tag { color: #4b5563; }
      .dock.dark .tag { color: #9ca3af; }
      .dock img { width: 64px; height: 64px; }
      footer { margin-top: 40px; font-size: 12px; color: var(--muted); }
      code { background: #eceef1; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
"""

GALLERY_THUMB_SIZES = (256, 128, 64, 32)
GALLERY_THUMB_PX = {256: 112, 128: 72, 64: 48, 32: 32}


def hex_color(rgb):
    return "#%02x%02x%02x" % rgb


def gallery_page():
    """Build the comparison page for every palette and gallery size."""
    heroes = []
    for name, palette in PALETTES.items():
        swatches = "".join(
            '<span class="swatch" style="background:%s"></span>' % hex_color(c)
            for c in (palette["gradient"][0], palette["gradient"][1], palette["accent"])
        )
        heroes.append(
            f"""        <div class="card hero">
          <img src="icon-{name}-512.png" alt="{name}" />
          <div class="name">{name.capitalize()}</div>
          <div class="desc">{palette["desc"]}</div>
          <div class="swatches">
            {swatches}
          </div>
        </div>"""
        )

    strips = []
    for name in PALETTES:
        figures = []
        for size in GALLERY_THUMB_SIZES:
            px = GALLERY_THUMB_PX[size]
            figures.append(
                f'<figure><img src="icon-{name}-{size}.png" width="{px}" height="{px}" />'
                f"<figcaption>{size}</figcaption></figure>"
            )
        figures.append(
            f'<figure><img src="icon-{name}-32.png" width="16" height="16" />'
            "<figcaption>16 (缩放)</figcaption></figure>"
        )
        strips.append(
            f"""      <div class="strip">
        <span class="label">{name.capitalize()}</span>
        {"".join(figures)}
      </div>"""
        )

    docks = []
    for tone in ("light", "dark"):
        label = "浅色" if tone == "light" else "深色"
        images = "".join(
            f'<img src="icon-{name}-128.png" alt="{name}" />' for name in PALETTES
        )
        docks.append(
            f"""        <div class="dock {tone}">
          <span class="tag">{label}</span>
          {images}
        </div>"""
        )

    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Terminal 应用图标候选</title>
    <style>{GALLERY_STYLE}    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Terminal 应用图标候选</h1>
      <p class="lead">
        三套配色均为 1024×1024 程序化生成（<code>scripts/generate-icon.py</code>），
        已通过 <code>pnpm tauri icon</code> 产出全平台资产。
      </p>

      <div class="heroes">
{"".join(heroes)}
      </div>

      <h2>尺寸可读性（256 / 128 / 64 / 32）</h2>
{"".join(strips)}

      <h2>浅色 / 深色底座上的实际观感</h2>
      <div class="stage">
{"".join(docks)}
      </div>

      <footer>
        源图：<code>src-tauri/icons/icon-source.png</code>；运行
        <code>pnpm icon:source -- --palette NAME</code> 切配色，
        再执行 <code>pnpm icon</code> 重建资产。
      </footer>
    </div>
  </body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=os.path.join("src-tauri", "icons", "icon-source.png"))
    parser.add_argument("--palette", default="aurora", choices=sorted(PALETTES))
    parser.add_argument("--previews", help="render all palettes at 512px into this directory")
    parser.add_argument(
        "--gallery",
        help="render all palettes at every size in GALLERY_SIZES into this directory",
    )
    args = parser.parse_args()

    icon = render(args.palette)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    icon.save(args.output)
    print(f"icon source written: {args.output} ({args.palette})")

    if args.previews:
        os.makedirs(args.previews, exist_ok=True)
        for name in PALETTES:
            path = os.path.join(args.previews, f"icon-{name}-512.png")
            render(name, size=512).save(path)
            print(f"preview written: {path}")

    if args.gallery:
        os.makedirs(args.gallery, exist_ok=True)
        for name in PALETTES:
            for size in GALLERY_SIZES:
                path = os.path.join(args.gallery, f"icon-{name}-{size}.png")
                render(name, size=size).save(path)
                print(f"gallery written: {path}")
        page = os.path.join(args.gallery, "index.html")
        with open(page, "w", encoding="utf-8") as handle:
            handle.write(gallery_page())
        print(f"gallery page written: {page}")


if __name__ == "__main__":
    main()
