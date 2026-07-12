import { AudioEngine } from "./engine";

/** キーの種類。種類ごとに音色を変える。enter=IME確定など、return=実際の改行 */
export type KeyKind = "key" | "space" | "enter" | "return" | "delete";

export type KeySchemeId = "drop" | "typewriter" | "marimba" | "soft";

export const KEY_SCHEMES: Record<KeySchemeId, string> = {
	drop: "水滴",
	typewriter: "タイプライター",
	marimba: "木琴",
	soft: "ソフト",
};

/** キーリピート時の連射を抑える最小間隔 */
const MIN_INTERVAL_MS = 40;

/** マリンバ用の音階（Cメジャーペンタトニック） */
const MARIMBA_NOTES = [523.25, 587.33, 659.25, 783.99, 880.0];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/**
 * 打鍵音をWeb Audioでリアルタイム合成するプレイヤー。
 * 音源ファイルを持たないため配布サイズがゼロで、
 * 1打ごとにピッチ・音量が微妙に揺らぐので機械的な連打感が出ない。
 */
export class KeySoundPlayer {
	volume = 0.5; // 0..1
	scheme: KeySchemeId = "drop";
	private lastPlayed = 0;

	constructor(private engine: AudioEngine) {}

	play(kind: KeyKind): void {
		const now = performance.now();
		if (now - this.lastPlayed < MIN_INTERVAL_MS) return;
		this.lastPlayed = now;

		// 聴感に合わせた二乗カーブ + 打鍵ごとの微妙な強弱
		const level = this.volume * this.volume * rand(0.8, 1.0);
		if (level <= 0) return;

		this.engine.resume();
		switch (this.scheme) {
			case "drop":
				this.playDrop(kind, level);
				break;
			case "typewriter":
				this.playTypewriter(kind, level);
				break;
			case "marimba":
				this.playMarimba(kind, level);
				break;
			case "soft":
				this.playSoft(kind, level);
				break;
		}
	}

	/**
	 * 水滴: 1打ごとに「滴の大きさ」を決め、そこから
	 * 音程・長さ・跳ね上がり方・水面の共鳴を連動して変える。
	 * 実際の水滴のように、同じ音は二度と鳴らない。
	 */
	private playDrop(kind: KeyKind, level: number): void {
		const t = this.engine.context.currentTime;

		// 滴の大きさ (0=小粒, 1=大粒)。キー種別で範囲を変える
		let size = Math.random();
		let peak = 0.22;
		let freqScale = 1;
		if (kind === "space") {
			size = rand(0.55, 0.85);
			freqScale = 0.62;
		} else if (kind === "enter" || kind === "return") {
			size = rand(0.8, 1);
			freqScale = 0.55;
			peak = 0.26;
		} else if (kind === "delete") {
			size = rand(0, 0.3);
			peak = 0.16;
		}

		// 大きい粒ほど低く・長く鳴る
		const freq = lerp(1050, 480, size) * freqScale * rand(0.92, 1.08);
		const dur = lerp(0.09, 0.3, size) * rand(0.85, 1.15);
		// 跳ね上がりの強さと速さも毎回変える
		const bend = rand(1.12, 1.75);
		const bendTime = dur * rand(0.45, 0.85);
		this.chirp(t, freq, freq * bend, bendTime, dur, peak * level);

		// 高域のきらめき（当たり方が毎回違う）
		this.noiseHit(t, rand(2600, 4200), rand(0.008, 0.02), rand(0.03, 0.07) * level);

		// 大粒は水面の低い「ぼちゃ」という共鳴を伴う
		if (size > 0.45) {
			this.thump(t + 0.005, freq * 0.28, freq * 0.2, dur * 0.8, 0.1 * size * level);
		}

		// ときどき跳ねた滴がもう一度小さく落ちる（二度鳴り）
		if (kind === "key" && Math.random() < 0.28) {
			const f2 = freq * rand(1.15, 1.45);
			const d2 = dur * rand(0.5, 0.75);
			this.chirp(t + rand(0.045, 0.09), f2, f2 * rand(1.2, 1.5), d2 * 0.6, d2, peak * 0.4 * level);
		}
	}

	/** タイプライター: ノイズのクリック + 低域のタップ音。確定Enterでベル、改行でキャリッジリターン */
	private playTypewriter(kind: KeyKind, level: number): void {
		const t = this.engine.context.currentTime;
		if (kind === "enter") {
			this.tone(t, 1318.5, 0.5, 0.1 * level); // ベル (E6)
			this.noiseHit(t, 900, 0.05, 0.35 * level, "lowpass");
			this.thump(t, 140, 80, 0.06, 0.3 * level);
		} else if (kind === "return") {
			// 実際の改行: レバーを引いてキャリッジが戻る「ガチャッ」
			this.noiseHit(t, 2100, 0.02, 0.32 * level); // レバーのクリック
			this.noiseSweep(t + 0.03, 1600, 750, 0.12, 0.2 * level); // キャリッジが滑る音
			this.noiseHit(t + 0.14, 520, 0.06, 0.5 * level, "lowpass"); // 止まる瞬間のガチャ
			this.thump(t + 0.14, 115, 62, 0.09, 0.42 * level);
			this.noiseHit(t + 0.22, 700, 0.03, 0.16 * level, "lowpass"); // 小さな跳ね返り
		} else if (kind === "space") {
			this.noiseHit(t, 1800, 0.025, 0.3 * level);
			this.thump(t, 120, 70, 0.06, 0.35 * level);
		} else if (kind === "delete") {
			this.noiseHit(t, 2000, 0.02, 0.28 * level);
			this.thump(t, 150, 90, 0.04, 0.2 * level);
		} else {
			this.noiseHit(t, rand(2300, 2900), 0.03, 0.4 * level);
			this.thump(t, 160, 90, 0.05, 0.25 * level);
		}
	}

	/** 木琴: 基音 + 4倍音の短いストライク。ペンタトニックなので連打しても濁らない */
	private playMarimba(kind: KeyKind, level: number): void {
		let freq = MARIMBA_NOTES[Math.floor(Math.random() * MARIMBA_NOTES.length)];
		let dur = 0.4;
		let peak = 0.22;
		if (kind === "space") {
			freq = 392.0; // G4
			dur = 0.5;
		} else if (kind === "enter" || kind === "return") {
			freq = 261.63; // C4
			dur = 0.8;
			peak = 0.26;
		} else if (kind === "delete") {
			freq = 440.0;
			dur = 0.22;
			peak = 0.16;
		}
		freq *= rand(0.996, 1.004);
		const t = this.engine.context.currentTime;
		this.tone(t, freq, dur, peak * level);
		this.tone(t, freq * 4, dur * 0.15, 0.06 * level); // 木を叩いた瞬間の倍音
		this.noiseHit(t, 4000, 0.008, 0.03 * level);
	}

	/** ソフト: こもったノイズだけの静かなタップ。夜中の執筆向け */
	private playSoft(kind: KeyKind, level: number): void {
		const t = this.engine.context.currentTime;
		if (kind === "enter" || kind === "return") {
			this.noiseHit(t, 500, 0.05, 0.4 * level, "lowpass");
			this.thump(t, 130, 80, 0.05, 0.15 * level);
		} else if (kind === "space") {
			this.noiseHit(t, 550, 0.04, 0.38 * level, "lowpass");
		} else if (kind === "delete") {
			this.noiseHit(t, 650, 0.025, 0.3 * level, "lowpass");
		} else {
			this.noiseHit(t, rand(650, 800), 0.03, 0.35 * level, "lowpass");
			this.thump(t, 200, 150, 0.025, 0.08 * level);
		}
	}

	// ---- 部品となるシンセ ----

	/** 一定ピッチのサイン波（指数減衰） */
	private tone(t: number, freq: number, dur: number, peak: number): void {
		if (peak <= 0) return;
		const ctx = this.engine.context;
		const osc = ctx.createOscillator();
		osc.type = "sine";
		osc.frequency.value = freq;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(peak, t + 0.003);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(gain);
		gain.connect(this.engine.output);
		osc.start(t);
		osc.stop(t + dur + 0.05);
	}

	/** ピッチが滑らかに動くサイン波（水滴の「ぴちょん」）。bendTime = ピッチ変化にかける時間 */
	private chirp(t: number, from: number, to: number, bendTime: number, dur: number, peak: number): void {
		if (peak <= 0) return;
		const ctx = this.engine.context;
		const osc = ctx.createOscillator();
		osc.type = "sine";
		osc.frequency.setValueAtTime(from, t);
		osc.frequency.exponentialRampToValueAtTime(to, t + Math.min(bendTime, dur));
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(peak, t + 0.003);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(gain);
		gain.connect(this.engine.output);
		osc.start(t);
		osc.stop(t + dur + 0.05);
	}

	/** フィルターを通した短いノイズ（クリック・きらめき・タップ） */
	private noiseHit(
		t: number,
		freq: number,
		dur: number,
		peak: number,
		type: BiquadFilterType = "bandpass"
	): void {
		if (peak <= 0) return;
		const ctx = this.engine.context;
		const src = ctx.createBufferSource();
		src.buffer = this.engine.noiseBuffer;
		const filter = ctx.createBiquadFilter();
		filter.type = type;
		filter.frequency.value = freq;
		filter.Q.value = 1;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(peak, t + 0.002);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, 0.01));
		src.connect(filter);
		filter.connect(gain);
		gain.connect(this.engine.output);
		src.start(t, Math.random() * 1.5); // バッファのランダムな位置から
		src.stop(t + dur + 0.05);
	}

	/** 中心周波数が滑らかに動くノイズ（キャリッジが滑る「シャーッ」） */
	private noiseSweep(t: number, from: number, to: number, dur: number, peak: number): void {
		if (peak <= 0) return;
		const ctx = this.engine.context;
		const src = ctx.createBufferSource();
		src.buffer = this.engine.noiseBuffer;
		const filter = ctx.createBiquadFilter();
		filter.type = "bandpass";
		filter.frequency.setValueAtTime(from, t);
		filter.frequency.exponentialRampToValueAtTime(to, t + dur);
		filter.Q.value = 1.2;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(peak, t + 0.01);
		gain.gain.setValueAtTime(peak, t + dur * 0.7);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(filter);
		filter.connect(gain);
		gain.connect(this.engine.output);
		src.start(t, Math.random() * 1.5);
		src.stop(t + dur + 0.05);
	}

	/** ピッチが落ちる低域の「とん」という音 */
	private thump(t: number, from: number, to: number, dur: number, peak: number): void {
		if (peak <= 0) return;
		const ctx = this.engine.context;
		const osc = ctx.createOscillator();
		osc.type = "sine";
		osc.frequency.setValueAtTime(from, t);
		osc.frequency.exponentialRampToValueAtTime(to, t + dur);
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(peak, t + 0.004);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(gain);
		gain.connect(this.engine.output);
		osc.start(t);
		osc.stop(t + dur + 0.05);
	}
}
