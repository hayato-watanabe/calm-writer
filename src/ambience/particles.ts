import { ParticleKind } from "./scenes";
import type { SkyState } from "./sky";
import MOON_TEXTURE from "../assets/moon.png";

interface Particle {
	x: number;
	y: number;
	r: number;
	speed: number;
	phase: number;
	alpha: number;
	/** 蛍の明滅の残り秒（森のみ、0 = 明滅していない） */
	flare: number;
}

interface ShootingStar {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	age: number;
}

const FLARE_DUR = 1.6;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * 背景に重ねるパーティクル演出（雪・星・光の粒）。
 * canvas は本文の背面（bodyの背景の上、ワークスペースの下）に置かれる。
 * 遊び心として、雪にはときどき吹く風、星には月と流れ星、
 * 光の粒には蛍のような明滅を仕込んである。
 */
export class ParticleLayer {
	private canvas: HTMLCanvasElement | null = null;
	private ctx2d: CanvasRenderingContext2D | null = null;
	private raf = 0;
	private items: Particle[] = [];
	private kind: Exclude<ParticleKind, "none"> = "snow";
	private lastTime = 0;
	private readonly onResize = () => this.resize();
	/** 空の状態（夜空の時間経過が動いているときだけ non-null を返す） */
	private skyProvider: (() => SkyState | null) | null = null;
	// 雪の突風
	private gustAt = 0;
	private gustStart = 0;
	private gustDur = 0;
	private gustDir = 1;
	// 流れ星
	private nextShootAt = 0;
	private shooting: ShootingStar | null = null;

	start(kind: ParticleKind, sky?: () => SkyState | null): void {
		this.stop();
		if (kind === "none") return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		this.kind = kind;
		this.skyProvider = sky ?? null;
		this.canvas = document.body.createEl("canvas", { cls: "immersive-writer-particles" });
		this.ctx2d = this.canvas.getContext("2d");
		window.addEventListener("resize", this.onResize);
		this.resize();
		const now = performance.now();
		this.lastTime = now;
		this.gustAt = now + rand(30, 90) * 1000;
		this.gustStart = 0;
		this.nextShootAt = now + rand(30, 120) * 1000;
		this.shooting = null;
		this.raf = window.requestAnimationFrame((t) => this.frame(t));
	}

	stop(): void {
		if (this.raf) window.cancelAnimationFrame(this.raf);
		this.raf = 0;
		window.removeEventListener("resize", this.onResize);
		this.canvas?.remove();
		this.canvas = null;
		this.ctx2d = null;
		this.items = [];
		this.skyProvider = null;
	}

	private resize(): void {
		if (!this.canvas) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.canvas.width = window.innerWidth * dpr;
		this.canvas.height = window.innerHeight * dpr;
		this.ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.seed();
	}

	private seed(): void {
		const w = window.innerWidth;
		const h = window.innerHeight;
		// 種類ごとに密度を変える（星は多め、光の粒はまばら）
		const density =
			this.kind === "stars" || this.kind === "aurora" ? 9000 : this.kind === "snow" ? 16000 : 30000;
		const n = Math.max(30, Math.min(200, Math.round((w * h) / density)));
		this.items = [];
		for (let i = 0; i < n; i++) {
			this.items.push({
				x: Math.random() * w,
				y: Math.random() * h,
				r: this.kind === "stars" ? 0.5 + Math.random() * 1.2 : 0.8 + Math.random() * 2.2,
				speed: this.kind === "snow" ? 18 + Math.random() * 40 : 4 + Math.random() * 8,
				phase: Math.random() * Math.PI * 2,
				alpha: 0.3 + Math.random() * 0.5,
				flare: 0,
			});
		}
	}

	private frame(now: number): void {
		if (!this.canvas || !this.ctx2d) return;
		const dt = Math.min((now - this.lastTime) / 1000, 0.1);
		this.lastTime = now;
		const w = window.innerWidth;
		const h = window.innerHeight;
		const c = this.ctx2d;
		const t = now / 1000;
		c.clearRect(0, 0, w, h);

		const sky = this.skyProvider ? this.skyProvider() : null;
		const starDim = sky ? sky.starAlpha : 1;

		if (this.kind === "stars" && sky) this.drawMoon(c, w, h, sky);
		if (this.kind === "aurora") this.drawAurora(c, w, h, t);
		const wind = this.kind === "snow" ? this.windStrength(now, t) : 0;

		for (const p of this.items) {
			let alpha = p.alpha;
			let r = p.r;
			if (this.kind === "snow") {
				p.y += p.speed * dt;
				// 軽い粒ほど風に流される
				p.x += (Math.sin(t * 0.7 + p.phase) * 12 + (wind * (3.4 - p.r)) / 2.6) * dt;
				if (p.y > h + 4) {
					p.y = -4;
					p.x = Math.random() * w;
				}
				if (p.x > w + 4) p.x = -4;
				else if (p.x < -4) p.x = w + 4;
				c.fillStyle = "#ffffff";
			} else if (this.kind === "stars" || this.kind === "aurora") {
				alpha = p.alpha * (0.55 + 0.45 * Math.sin(t * (0.3 + p.phase * 0.15) + p.phase)) * starDim;
				if (alpha < 0.01) continue;
				c.fillStyle = "#dfe6ff";
			} else {
				// motes: ゆっくり立ちのぼる光の粒。まれに蛍のようにふっと明るくなる
				p.y -= p.speed * dt;
				p.x += Math.sin(t * 0.4 + p.phase) * 6 * dt;
				if (p.y < -4) {
					p.y = h + 4;
					p.x = Math.random() * w;
				}
				if (p.flare > 0) {
					p.flare = Math.max(0, p.flare - dt);
					const fp = 1 - p.flare / FLARE_DUR;
					const glow = Math.sin(Math.PI * fp);
					alpha = p.alpha + glow * 0.45;
					r = p.r + glow * 0.8;
				} else if (Math.random() < dt * 0.002) {
					p.flare = FLARE_DUR;
				}
				c.fillStyle = "#cfe8c0";
			}
			c.globalAlpha = alpha;
			c.beginPath();
			c.arc(p.x, p.y, r, 0, Math.PI * 2);
			c.fill();
		}
		c.globalAlpha = 1;

		if (this.kind === "stars" || this.kind === "aurora") {
			this.updateShootingStar(c, w, h, dt, now, starDim);
		}

		this.raf = window.requestAnimationFrame((n) => this.frame(n));
	}

	/** オーロラのカーテン。うねる上端と揺れる明滅を持つ縦のグラデーション帯 */
	private auroraStrips: HTMLCanvasElement[] = [];

	/**
	 * カーテン1本ぶんの縦グラデーションを現在時刻の色で描き直す。
	 * 実際のオーロラの色構造（下端=酸素の緑557nm、上空=酸素の赤/窒素の紫）を保ったまま、
	 * 色相を数分周期でゆっくり漂わせる:
	 * - 本体: 緑(140°)を中心に 黄緑(115°)〜ティール(165°) を往復
	 * - 上部: 紫(272°)を中心に 青紫〜ピンク を往復し、濃さも満ち引きする
	 */
	private auroraStrip(band: number, t: number): HTMLCanvasElement {
		let cv = this.auroraStrips[band];
		if (!cv) {
			cv = document.createElement("canvas");
			cv.width = 1;
			cv.height = 256;
			this.auroraStrips[band] = cv;
		}
		const g = cv.getContext("2d") as CanvasRenderingContext2D;
		const bodyHue =
			140 + 18 * Math.sin(t * 0.023 + band * 1.3) + 8 * Math.sin(t * 0.041 + 1.7 + band);
		const topHue = 272 + 26 * Math.sin(t * 0.017 + 0.8 + band * 0.9);
		const topA = 0.1 + 0.05 * Math.sin(t * 0.011 + band * 2.2);
		g.clearRect(0, 0, 1, 256);
		const grad = g.createLinearGradient(0, 0, 0, 256);
		grad.addColorStop(0, `hsla(${topHue.toFixed(1)}, 70%, 65%, 0)`);
		grad.addColorStop(0.3, `hsla(${topHue.toFixed(1)}, 65%, 62%, ${topA.toFixed(3)})`);
		grad.addColorStop(0.62, `hsla(${(bodyHue + 20).toFixed(1)}, 70%, 58%, 0.15)`);
		grad.addColorStop(0.9, `hsla(${bodyHue.toFixed(1)}, 85%, 60%, 0.42)`);
		grad.addColorStop(0.97, `hsla(${(bodyHue - 6).toFixed(1)}, 90%, 70%, 0.5)`);
		grad.addColorStop(1, `hsla(${bodyHue.toFixed(1)}, 85%, 70%, 0.12)`);
		g.fillStyle = grad;
		g.fillRect(0, 0, 1, 256);
		return cv;
	}

	private drawAurora(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
		const prev = c.globalCompositeOperation;
		c.globalCompositeOperation = "lighter"; // 光として加算合成する
		const stripW = 10;
		for (let band = 0; band < 2; band++) {
			const strip = this.auroraStrip(band, t);
			const yBase = h * (band === 0 ? 0.1 : 0.2);
			// 現実のオーロラよりずっとゆったり漂わせる（集中を妨げない速さ）
			const drift = t * (band === 0 ? 0.35 : -0.22);
			// 全体の明るさも数分周期で静かに満ち引きする
			const activity = 0.75 + 0.25 * Math.sin(t * 0.013 + band * 2.6);
			for (let x = -stripW; x < w + stripW; x += stripW) {
				const u = x / w;
				const yTop =
					yBase +
					Math.sin(u * 3.4 + drift * 0.25 + band * 2.1) * h * 0.055 +
					Math.sin(u * 7.5 - drift * 0.4) * h * 0.024;
				const len = h * (0.15 + 0.11 * (0.5 + 0.5 * Math.sin(u * 5.6 + drift * 0.33 + band)));
				const shimmer = 0.5 + 0.5 * Math.sin(u * 9 + t * 0.22 + band * 3);
				c.globalAlpha = 0.32 * activity * (0.45 + 0.55 * shimmer);
				c.drawImage(strip, x, yTop, stripW, len);
			}
		}
		c.globalAlpha = 1;
		c.globalCompositeOperation = prev;
	}

	/** 雪の横風。ふだんは微風、ときどき数秒間の突風が吹く */
	private windStrength(now: number, t: number): number {
		let wind = Math.sin(t * 0.05) * 6;
		if (this.gustStart === 0 && now >= this.gustAt) {
			this.gustStart = now;
			this.gustDur = rand(5, 10) * 1000;
			this.gustDir = Math.random() < 0.5 ? -1 : 1;
		}
		if (this.gustStart > 0) {
			const gp = (now - this.gustStart) / this.gustDur;
			if (gp >= 1) {
				this.gustStart = 0;
				this.gustAt = now + rand(60, 180) * 1000;
			} else {
				wind += Math.sin(Math.PI * gp) * 55 * this.gustDir;
			}
		}
		return wind;
	}

	/** 月。時間経過(SkyCycle)が動いているときだけ夜空を渡っていく */
	private drawMoon(c: CanvasRenderingContext2D, w: number, h: number, sky: SkyState): void {
		if (sky.moonAlpha < 0.01) return;
		const mx = sky.moonX * w;
		const my = sky.moonY * h;
		const r = Math.max(14, Math.min(26, Math.min(w, h) * 0.022));
		const a = sky.moonAlpha;

		// 光暈。実際の月暈と同じく指数関数的な減衰を多段の色停止点で近似し、
		// 月の5.5倍の距離までゆるやかに尾を引かせる（線形減衰だと外縁が輪郭に見える）
		const halo = c.createRadialGradient(mx, my, r * 0.9, mx, my, r * 5.5);
		const HALO_FALLOFF: [number, number][] = [
			[0, 0.4],
			[0.1, 0.26],
			[0.22, 0.16],
			[0.38, 0.085],
			[0.55, 0.04],
			[0.72, 0.016],
			[0.88, 0.006],
			[1, 0],
		];
		for (const [pos, alpha] of HALO_FALLOFF) {
			halo.addColorStop(pos, `rgba(226, 232, 248, ${(alpha * a).toFixed(3)})`);
		}
		c.fillStyle = halo;
		c.beginPath();
		c.arc(mx, my, r * 5.5, 0, Math.PI * 2);
		c.fill();

		// 本体。実際の月の地理（海・光条）を焼き込んだテクスチャを描く
		const img = this.moonImage();
		if (img.complete && img.naturalWidth > 0) {
			c.globalAlpha = 0.95 * a;
			c.drawImage(img, mx - r, my - r, r * 2, r * 2);
			c.globalAlpha = 1;
		} else {
			// テクスチャ読み込み完了までの一瞬だけ素のディスクを出す
			c.globalAlpha = 0.9 * a;
			c.fillStyle = "#e4eaf6";
			c.beginPath();
			c.arc(mx, my, r, 0, Math.PI * 2);
			c.fill();
			c.globalAlpha = 1;
		}
	}

	private moonImg: HTMLImageElement | null = null;

	private moonImage(): HTMLImageElement {
		if (!this.moonImg) {
			this.moonImg = new Image();
			this.moonImg.src = MOON_TEXTURE;
		}
		return this.moonImg;
	}

	/** 流れ星。1〜2分半に一度、夜空をすっと横切る */
	private updateShootingStar(
		c: CanvasRenderingContext2D,
		w: number,
		h: number,
		dt: number,
		now: number,
		starDim: number
	): void {
		if (!this.shooting && now >= this.nextShootAt) {
			this.nextShootAt = now + rand(45, 150) * 1000;
			// 空が明るい時間帯（夕暮れ・夜明け）には流さない
			if (starDim > 0.5) {
				const dir = Math.random() < 0.5 ? -1 : 1;
				const speed = Math.max(w, h) * rand(0.9, 1.3);
				const angle = rand(0.35, 0.6);
				this.shooting = {
					x: rand(0.15, 0.85) * w,
					y: rand(0.05, 0.3) * h,
					vx: dir * Math.cos(angle) * speed,
					vy: Math.sin(angle) * speed,
					life: rand(0.5, 0.8),
					age: 0,
				};
			}
		}
		const s = this.shooting;
		if (!s) return;
		s.age += dt;
		if (s.age >= s.life) {
			this.shooting = null;
			return;
		}
		s.x += s.vx * dt;
		s.y += s.vy * dt;
		const fade = Math.sin(Math.PI * (s.age / s.life)); // すっと現れてすっと消える
		const tail = 0.09; // 尾の長さ（秒換算）
		const grad = c.createLinearGradient(s.x, s.y, s.x - s.vx * tail, s.y - s.vy * tail);
		grad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * fade * starDim})`);
		grad.addColorStop(1, "rgba(255, 255, 255, 0)");
		c.strokeStyle = grad;
		c.lineWidth = 1.6;
		c.lineCap = "round";
		c.beginPath();
		c.moveTo(s.x, s.y);
		c.lineTo(s.x - s.vx * tail, s.y - s.vy * tail);
		c.stroke();
	}
}
