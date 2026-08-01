#!/usr/bin/env python3
"""Renderer PNG caption transparan untuk RACUN.AI (PIL).
Input: file JSON berisi daftar item:
  [{"out": "/path/card0.png", "text": "...", "highlight_words": ["85","ribu"],
    "size": 56, "fill": [255,255,255], "highlight_fill": [255,220,60],
    "stroke_fill": [0,0,0], "stroke_width": 4, "max_width": 660}]
Output: PNG transparan per item (teks tebal putih + outline gelap, kata kunci berwarna).
"""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts", "Poppins-ExtraBold.ttf"),
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]

def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

def render_badge(item: dict) -> None:
    """Badge/pill bergaya tombol: latar rounded semi-transparan + teks bold di tengah."""
    size = item.get("size", 46)
    font = load_font(size)
    fill = tuple(item.get("fill", [255, 255, 255]))
    bg = tuple(item.get("bg", [0, 0, 0, 170]))
    sw = item.get("stroke_width", 0)
    pad_x, pad_y = item.get("pad_x", 52), item.get("pad_y", 26)
    radius = item.get("radius", 44)
    text = item["text"]
    probe = Image.new("RGBA", (8, 8))
    pd = ImageDraw.Draw(probe)
    tw = int(pd.textlength(text, font=font))
    w = tw + pad_x * 2
    h = int(size * 1.3) + pad_y * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w, h], radius=radius, fill=bg)
    d.text(((w - tw) // 2, pad_y), text, font=font, fill=fill, stroke_width=sw, stroke_fill=(0, 0, 0))
    img.save(item["out"])

def render_item(item: dict) -> None:
    size = item.get("size", 56)
    font = load_font(size)
    fill = tuple(item.get("fill", [255, 255, 255]))
    hfill = tuple(item.get("highlight_fill", [255, 220, 60]))
    sfill = tuple(item.get("stroke_fill", [0, 0, 0]))
    sw = item.get("stroke_width", 4)
    max_w = item.get("max_width", 660)
    highlights = {w.lower().strip(".,!?") for w in item.get("highlight_words", [])}
    words = item["text"].split()

    probe = Image.new("RGBA", (8, 8))
    pd = ImageDraw.Draw(probe)

    def word_w(word: str) -> int:
        return int(pd.textlength(word, font=font)) + 2 * sw

    space_w = int(pd.textlength(" ", font=font))
    line_h = int(size * 1.25)

    # wrap: susun kata ke baris agar muat max_w
    lines = []
    cur, cur_w = [], 0
    for w in words:
        ww = word_w(w)
        add = ww if not cur else ww + space_w
        if cur and cur_w + add > max_w:
            lines.append(cur)
            cur, cur_w = [w], ww
        else:
            cur.append(w)
            cur_w += add
    if cur:
        lines.append(cur)

    width = max_w + 2 * 20
    height = len(lines) * line_h + 2 * 24
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    y = 24
    for line in lines:
        total = sum(word_w(w) for w in line) + space_w * (len(line) - 1)
        x = (width - total) // 2
        for w in line:
            color = hfill if w.lower().strip(".,!?") in highlights else fill
            d.text((x, y), w, font=font, fill=color, stroke_width=sw, stroke_fill=sfill)
            x += word_w(w) + space_w
        y += line_h

    img.save(item["out"])

def main() -> None:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        items = json.load(f)
    for item in items:
        if item.get("type") == "badge":
            render_badge(item)
        else:
            render_item(item)
    print(f"rendered {len(items)} png")

if __name__ == "__main__":
    main()
