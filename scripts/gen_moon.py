"""実際の月（表側）の地理に基づく満月テクスチャの生成。

海（マリア）の位置・形状・比率は実物の月面図に合わせている。
512pxで生成して160pxに縮小し、寒色トーン + ソフトな円形アルファで書き出す。
"""
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image

S = 512
R = S / 2
yy, xx = np.mgrid[0:S, 0:S]
# 月面座標 (-1..1)。x右, y下
x = (xx - R + 0.5) / R
y = (yy - R + 0.5) / R
d = np.sqrt(x * x + y * y)

rng = np.random.default_rng(7)


def ellipse(cx, cy, a, b, rot_deg=0.0, edge=0.08):
    """回転楕円のソフトマスク (0..1)"""
    t = np.deg2rad(rot_deg)
    u = (x - cx) * np.cos(t) + (y - cy) * np.sin(t)
    v = -(x - cx) * np.sin(t) + (y - cy) * np.cos(t)
    e = np.sqrt((u / a) ** 2 + (v / b) ** 2)
    return np.clip((1 - e) / edge, 0, 1)


# ---- 高地（ベース）: 細かい起伏のある明るい地形 ----
base = 0.86 + 0.10 * gaussian_filter(rng.standard_normal((S, S)), 18)
base += 0.05 * gaussian_filter(rng.standard_normal((S, S)), 5)

# ---- 海。おおよそ実際の位置・大きさ ----
maria = np.zeros((S, S))
maria += 0.95 * ellipse(-0.28, -0.36, 0.26, 0.24, 15)        # 雨の海 (Imbrium)
maria += 0.85 * ellipse(-0.55, -0.02, 0.24, 0.42, 8)         # 嵐の大洋 (Procellarum)
maria += 0.90 * ellipse(0.10, -0.33, 0.17, 0.15, -10)        # 晴れの海 (Serenitatis)
maria += 0.90 * ellipse(0.28, -0.10, 0.17, 0.20, 20)         # 静かの海 (Tranquillitatis)
maria += 0.90 * ellipse(0.62, -0.17, 0.11, 0.085, -20)       # 危難の海 (Crisium)
maria += 0.80 * ellipse(0.46, 0.14, 0.13, 0.16, 35)          # 豊かの海 (Fecunditatis)
maria += 0.75 * ellipse(0.29, 0.24, 0.09, 0.10, 0)           # 神酒の海 (Nectaris)
maria += 0.75 * ellipse(-0.18, 0.26, 0.15, 0.11, -12)        # 雲の海 (Nubium)
maria += 0.75 * ellipse(-0.42, 0.31, 0.09, 0.08, 0)          # 湿りの海 (Humorum)
maria += 0.45 * ellipse(-0.10, -0.57, 0.30, 0.075, 3, edge=0.22)         # 氷の海 (Frigoris)
maria += 0.55 * ellipse(0.02, -0.10, 0.06, 0.07, 0)          # 蒸気の海 (Vaporum)
maria = np.clip(maria, 0, 1)
# 海の縁を不規則にする（ノイズで輪郭を揺らす）
maria = np.clip(maria + 0.4 * gaussian_filter(rng.standard_normal((S, S)), 7) * np.clip(maria * 1.5, 0, 1), 0, 1)
maria = gaussian_filter(maria, 4)

value = base * (1 - 0.30 * maria)

# ---- 明るいクレーターと光条 ----
def bright_spot(cx, cy, r, amp):
    return amp * np.clip((1 - np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r), 0, 1)

# ティコ + 放射状の光条
value += bright_spot(-0.08, 0.62, 0.05, 0.30)
rays = np.zeros((S, S))
for ang in np.linspace(0, 2 * np.pi, 13, endpoint=False):
    dxu, dyu = np.cos(ang), np.sin(ang)
    along = (x + 0.08) * dxu + (y - 0.62) * dyu
    across = -(x + 0.08) * dyu + (y - 0.62) * dxu
    ray = np.clip(1 - np.abs(across) / 0.012, 0, 1) * np.clip(along / 0.9, 0, 1) * np.clip(1 - along / 0.9, 0, 1)
    rays += ray
value += 0.10 * gaussian_filter(np.clip(rays, 0, 1), 3)
# コペルニクスとケプラー
value += bright_spot(-0.32, -0.06, 0.035, 0.22)
value += bright_spot(-0.56, -0.04, 0.022, 0.16)
value += bright_spot(0.32, 0.42, 0.03, 0.18)  # ティコ以外の南部高地の明部

# 細かいクレーターの粒状感
value += 0.05 * gaussian_filter(rng.standard_normal((S, S)), 1.6)
value += 0.035 * gaussian_filter(rng.standard_normal((S, S)), 0.8)
value = gaussian_filter(value, 1.2)

# ---- 弱い周縁減光（満月は平板に見えるのでごく弱く） ----
limb = 0.80 + 0.20 * np.sqrt(np.clip(1 - d ** 2, 0, 1))
value *= limb
value = np.clip(value, 0, 1)

# ---- 寒色トーンに着色 + ソフトな円形アルファ ----
tint = (0.878, 0.906, 0.965)  # 224,231,246 相当の月光色
rgb = [(value * t * 255).astype(np.uint8) for t in tint]
alpha_soft = np.clip((1 - d) * R / 3.0, 0, 1)  # 縁の約3pxをフェード
a8 = (alpha_soft * 255).astype(np.uint8)

img = Image.merge("RGBA", [Image.fromarray(c) for c in rgb + [a8]])
img = img.resize((160, 160), Image.LANCZOS)
img.save("moon.png", optimize=True)

# 確認用に夜空色の背景に合成した拡大版も出す
prev = Image.new("RGBA", (400, 200), (13, 17, 40, 255))
big = img.resize((160, 160))
small = img.resize((52, 52), Image.LANCZOS)
prev.alpha_composite(big, (20, 20))
prev.alpha_composite(small, (250, 74))
prev.convert("RGB").save("moon_preview.png")
import os
print("moon.png:", os.path.getsize("moon.png"), "bytes")
