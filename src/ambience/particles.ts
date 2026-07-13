import { ParticleKind } from "./scenes";
import type { SkyState } from "./sky";

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

/** 月の海（暗い模様）の配置。[x, y, 半径] いずれも月の半径に対する割合 */
const MOON_MARIA: [number, number, number][] = [
	[-0.28, -0.12, 0.42],
	[0.26, 0.08, 0.3],
	[0.02, 0.38, 0.26],
	[-0.14, -0.46, 0.18],
	[0.42, -0.28, 0.14],
	[0.18, -0.2, 0.16],
];

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
		const density = this.kind === "stars" ? 9000 : this.kind === "snow" ? 16000 : 30000;
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
			} else if (this.kind === "stars") {
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

		if (this.kind === "stars") this.updateShootingStar(c, w, h, dt, now, starDim);

		this.raf = window.requestAnimationFrame((n) => this.frame(n));
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

		// 控えめな光暈。空が暗いほど広がって見える
		const halo = c.createRadialGradient(mx, my, r * 0.6, mx, my, r * 2.4);
		halo.addColorStop(0, `rgba(226, 232, 248, ${0.3 * a})`);
		halo.addColorStop(1, "rgba(226, 232, 248, 0)");
		c.fillStyle = halo;
		c.beginPath();
		c.arc(mx, my, r * 2.4, 0, Math.PI * 2);
		c.fill();

		// 本体。縁をわずかに暗くして球らしさを出す
		const disc = c.createRadialGradient(mx - r * 0.2, my - r * 0.2, r * 0.2, mx, my, r);
		disc.addColorStop(0, `rgba(240, 244, 252, ${0.95 * a})`);
		disc.addColorStop(0.75, `rgba(228, 234, 248, ${0.92 * a})`);
		disc.addColorStop(1, `rgba(196, 208, 232, ${0.85 * a})`);
		c.fillStyle = disc;
		c.beginPath();
		c.arc(mx, my, r, 0, Math.PI * 2);
		c.fill();

		// 海（暗い模様）。月面に固定した配置で描く
		c.save();
		c.beginPath();
		c.arc(mx, my, r, 0, Math.PI * 2);
		c.clip();
		c.fillStyle = `rgba(148, 162, 196, ${0.32 * a})`;
		for (const [ox, oy, or] of MOON_MARIA) {
			c.beginPath();
			c.arc(mx + ox * r, my + oy * r, or * r, 0, Math.PI * 2);
			c.fill();
		}
		c.restore();
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
