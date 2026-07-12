import { ParticleKind } from "./scenes";

interface Particle {
	x: number;
	y: number;
	r: number;
	speed: number;
	phase: number;
	alpha: number;
}

/**
 * 背景に重ねるパーティクル演出（雪・星・光の粒）。
 * canvas は本文の背面（bodyの背景の上、ワークスペースの下）に置かれる。
 */
export class ParticleLayer {
	private canvas: HTMLCanvasElement | null = null;
	private ctx2d: CanvasRenderingContext2D | null = null;
	private raf = 0;
	private items: Particle[] = [];
	private kind: Exclude<ParticleKind, "none"> = "snow";
	private lastTime = 0;
	private readonly onResize = () => this.resize();

	start(kind: ParticleKind): void {
		this.stop();
		if (kind === "none") return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		this.kind = kind;
		this.canvas = document.body.createEl("canvas", { cls: "immersive-writer-particles" });
		this.ctx2d = this.canvas.getContext("2d");
		window.addEventListener("resize", this.onResize);
		this.resize();
		this.lastTime = performance.now();
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

		for (const p of this.items) {
			let alpha = p.alpha;
			if (this.kind === "snow") {
				p.y += p.speed * dt;
				p.x += Math.sin(t * 0.7 + p.phase) * 12 * dt;
				if (p.y > h + 4) {
					p.y = -4;
					p.x = Math.random() * w;
				}
				if (p.x > w + 4) p.x = -4;
				else if (p.x < -4) p.x = w + 4;
				c.fillStyle = "#ffffff";
			} else if (this.kind === "stars") {
				alpha = p.alpha * (0.55 + 0.45 * Math.sin(t * (0.3 + p.phase * 0.15) + p.phase));
				c.fillStyle = "#dfe6ff";
			} else {
				// motes: ゆっくり立ちのぼる光の粒
				p.y -= p.speed * dt;
				p.x += Math.sin(t * 0.4 + p.phase) * 6 * dt;
				if (p.y < -4) {
					p.y = h + 4;
					p.x = Math.random() * w;
				}
				c.fillStyle = "#cfe8c0";
			}
			c.globalAlpha = alpha;
			c.beginPath();
			c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			c.fill();
		}
		c.globalAlpha = 1;
		this.raf = window.requestAnimationFrame((n) => this.frame(n));
	}
}
