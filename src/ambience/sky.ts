/**
 * 夜空シーンの「時の流れ」。
 * 没入モードに入った瞬間を夕暮れ(18:00)とし、実時間1分 = 作中10分の速さで
 * 夜が更け、月が渡り、やがて夜明けが来る（全行程 約78分）。
 * 朝(7:00)まで進んだら穏やかな朝の空で静止する。
 *
 * 空のグラデーションだけでなく、文字色・ビネットも同期して補間することで
 * どの時刻でも本文が読めるようにしている。
 */

export interface SkyState {
	/** 星の見えやすさ 0..1（パーティクル層が参照する） */
	starAlpha: number;
	/** 月の位置（画面に対する割合 0..1）と不透明度 */
	moonX: number;
	moonY: number;
	moonAlpha: number;
}

/** 実時間1秒あたりに進む作中の秒数 */
const TIME_SCALE = 10;
/** 開始時の作中時刻（時） */
const START_HOUR = 18;
const MOON_RISE = 20;
const MOON_SET = 28.5; // 4:30

interface SkyKeyframe {
	h: number; // 作中時刻（24を超えて連続）
	sky: [string, string, string]; // 上・中・下のグラデーション色
	text: string;
	muted: string;
	vig: [number, number, number, number]; // ビネット色 rgba
	star: number;
}

const KEYFRAMES: SkyKeyframe[] = [
	// 夕焼けの名残り
	{ h: 18.0, sky: ["#3a3f6e", "#7a5580", "#e8875a"], text: "#f2e8dc", muted: "#c9b39e", vig: [40, 20, 40, 0.5], star: 0 },
	// 残照が消えていく
	{ h: 19.2, sky: ["#232b52", "#463a66", "#a85a4e"], text: "#dcd8e0", muted: "#a49aae", vig: [20, 10, 35, 0.55], star: 0.35 },
	// 夜
	{ h: 20.5, sky: ["#0a0e22", "#141a38", "#232b52"], text: "#c9d3e8", muted: "#6d7a99", vig: [0, 0, 10, 0.65], star: 1 },
	// 真夜中
	{ h: 24.0, sky: ["#05070f", "#0a0e1e", "#121631"], text: "#b9c4da", muted: "#5d6a89", vig: [0, 0, 8, 0.7], star: 1 },
	// 夜明け前の最も暗い時間
	{ h: 28.0, sky: ["#06080f", "#0b101f", "#141a38"], text: "#b9c4da", muted: "#5d6a89", vig: [0, 0, 8, 0.7], star: 1 },
	// 東の空が薄まってくる
	{ h: 29.0, sky: ["#0a1026", "#1b2450", "#31406e"], text: "#c2cbe0", muted: "#6d7a99", vig: [5, 5, 25, 0.6], star: 0.8 },
	// 夜明け
	{ h: 29.8, sky: ["#1d2b52", "#50639a", "#e08a5f"], text: "#e8e4da", muted: "#b0a89a", vig: [25, 25, 55, 0.5], star: 0.25 },
	// 日の出
	{ h: 30.3, sky: ["#5b83b8", "#93b2d6", "#e8c9a8"], text: "#4a5468", muted: "#8593a8", vig: [60, 85, 120, 0.4], star: 0 },
	// 朝（ここで静止）
	{ h: 31.0, sky: ["#7fa8d0", "#a8c4dd", "#e6dcc8"], text: "#3f4c5e", muted: "#84919f", vig: [70, 100, 140, 0.35], star: 0 },
];

const INLINE_PROPS = [
	"background-image",
	"background-size",
	"--iw-text",
	"--iw-text-muted",
	"--iw-vignette-color",
];

const hex = (s: string): [number, number, number] => [
	parseInt(s.slice(1, 3), 16),
	parseInt(s.slice(3, 5), 16),
	parseInt(s.slice(5, 7), 16),
];
const mixN = (a: number, b: number, x: number) => a + (b - a) * x;
const mixHex = (a: string, b: string, x: number): string => {
	const ca = hex(a);
	const cb = hex(b);
	return `rgb(${Math.round(mixN(ca[0], cb[0], x))}, ${Math.round(mixN(ca[1], cb[1], x))}, ${Math.round(
		mixN(ca[2], cb[2], x)
	)})`;
};

export class SkyCycle {
	/** 実行中のみ非null。パーティクル層が毎フレーム参照する */
	state: SkyState | null = null;
	private timer: number | null = null;
	private startedAt = 0;

	start(): void {
		if (this.timer !== null) return;
		this.startedAt = Date.now();
		this.tick();
		this.timer = window.setInterval(() => this.tick(), 1000);
	}

	stop(): void {
		if (this.timer !== null) {
			window.clearInterval(this.timer);
			this.timer = null;
		}
		this.state = null;
		for (const p of INLINE_PROPS) document.body.style.removeProperty(p);
	}

	private tick(): void {
		const elapsed = (Date.now() - this.startedAt) / 1000;
		const h = START_HOUR + (elapsed * TIME_SCALE) / 3600;

		// 現在時刻を挟むキーフレーム区間を探して補間する
		const last = KEYFRAMES[KEYFRAMES.length - 1];
		let a = KEYFRAMES[0];
		let b = last;
		for (let i = 0; i < KEYFRAMES.length - 1; i++) {
			if (h >= KEYFRAMES[i].h && h <= KEYFRAMES[i + 1].h) {
				a = KEYFRAMES[i];
				b = KEYFRAMES[i + 1];
				break;
			}
		}
		const x = h >= last.h ? 1 : Math.max(0, Math.min(1, (h - a.h) / (b.h - a.h)));
		if (h >= last.h) a = last;

		const sky = [0, 1, 2].map((i) => mixHex(a.sky[i], b.sky[i], x));
		const text = mixHex(a.text, b.text, x);
		const muted = mixHex(a.muted, b.muted, x);
		const vig = a.vig.map((v, i) => mixN(v, b.vig[i], x));
		const star = mixN(a.star, b.star, x);

		const st = document.body.style;
		st.setProperty("background-image", `linear-gradient(180deg, ${sky[0]} 0%, ${sky[1]} 55%, ${sky[2]} 100%)`);
		st.setProperty("background-size", "100% 100%");
		st.setProperty("--iw-text", text);
		st.setProperty("--iw-text-muted", muted);
		st.setProperty(
			"--iw-vignette-color",
			`rgba(${Math.round(vig[0])}, ${Math.round(vig[1])}, ${Math.round(vig[2])}, ${vig[3].toFixed(2)})`
		);

		// 月の運行: 夜のあいだに画面を左から右へゆっくり渡る
		let moonX = 0;
		let moonY = 0;
		let moonAlpha = 0;
		if (h > MOON_RISE && h < MOON_SET) {
			const q = (h - MOON_RISE) / (MOON_SET - MOON_RISE);
			moonX = 0.12 + 0.72 * q;
			moonY = 0.34 - 0.24 * Math.sin(Math.PI * q);
			const edge = Math.min(1, Math.min(q, 1 - q) / 0.08); // 出入りはフェード
			moonAlpha = 0.85 * edge * Math.min(1, star * 1.2); // 空が暗いときだけ見える
		}

		this.state = { starAlpha: star, moonX, moonY, moonAlpha };
	}
}
