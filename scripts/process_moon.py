"""実写の満月写真から月テクスチャ (src/assets/moon.png) を生成する。

処理内容:
1. 黒背景から月のディスクを検出して正方形にクロップ
2. 160px に縮小
3. 夜空に馴染む寒色トーンへ着色
4. ディスクの縁にソフトな円形アルファを付与

使い方: python3 scripts/process_moon.py <満月写真> [出力先=src/assets/moon.png]
"""
import sys
import numpy as np
from PIL import Image, ImageOps

src_path = sys.argv[1] if len(sys.argv) > 1 else "scripts/moon_source.jpg"
out_path = sys.argv[2] if len(sys.argv) > 2 else "src/assets/moon.png"

im = Image.open(src_path).convert("L")
arr = np.asarray(im)

# ---- ディスク検出: 十分明るい画素の重心と広がりから中心・半径を求める ----
mask = arr > 25
ys, xs = np.where(mask)
cx, cy = xs.mean(), ys.mean()
# 半径は各行・列の広がりの95パーセンタイルから推定（ノイズ画素の影響を避ける）
r_est = np.percentile(np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2), 99.5)

pad = r_est * 1.01
box = (int(cx - pad), int(cy - pad), int(cx + pad), int(cy + pad))
im = im.crop(box)

# ---- 縮小と軽いコントラスト調整 ----
SIZE = 160
im = im.resize((SIZE, SIZE), Image.LANCZOS)
im = ImageOps.autocontrast(im, cutoff=0.3)

g = np.asarray(im).astype(float) / 255.0
# 白飛びさせずに全体を月光らしい明るさへ（97パーセンタイルを0.95に合わせる）
scale = 0.95 / max(np.percentile(g, 97), 1e-6)
g = np.clip(g * scale, 0, 1)

# ---- 寒色トーンに着色 + ソフトな円形アルファ ----
tint = (0.878, 0.906, 0.965)  # 月光色 (224,231,246 相当)
rgb = [(g * t * 255).astype(np.uint8) for t in tint]

R = SIZE / 2
yy, xx = np.mgrid[0:SIZE, 0:SIZE]
d = np.sqrt((xx - R + 0.5) ** 2 + (yy - R + 0.5) ** 2)
alpha = np.clip((R * 0.995 - d) / 2.0, 0, 1)  # 縁の約2pxをフェード
a8 = (alpha * 255).astype(np.uint8)

out = Image.merge("RGBA", [Image.fromarray(c) for c in rgb + [a8]])
out.save(out_path, optimize=True)

# 確認用プレビュー（夜空色に合成、実寸52px併記）
prev = Image.new("RGBA", (400, 200), (13, 17, 40, 255))
prev.alpha_composite(out, (20, 20))
prev.alpha_composite(out.resize((52, 52), Image.LANCZOS), (250, 74))
prev.convert("RGB").save("/tmp/moon_photo_preview.png")

import os
print(f"{out_path}: {os.path.getsize(out_path)} bytes (disc r={r_est:.0f}px in source)")
