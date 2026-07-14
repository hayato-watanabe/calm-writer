import { AudioEngine } from "./engine";

/** キーの種類。種類ごとに音色を変える。enter=IME確定など、return=実際の改行 */
export type KeyKind = "key" | "space" | "enter" | "return" | "delete";

export type KeySchemeId = "drop" | "drop2" | "typewriter" | "marimba" | "soft";

export const KEY_SCHEMES: Record<KeySchemeId, string> = {
	drop: "水滴",
	drop2: "水滴2（母音）",
	typewriter: "タイプライター",
	marimba: "木琴",
	soft: "ソフト",
};

/**
 * 水滴2: 母音キーごとの滴の大きさ (0=小粒・高い音, 1=大粒・低い音)。
 * 口の開きの大きさをそのまま滴の大きさに写像している。
 * ローマ字入力では1モーラに母音が1つ入るので、ことばのリズムで滴が落ちる。
 */
const VOWEL_DROP_SIZES: Record<string, number> = {
	KeyA: 0.8, // あ: 大きくひらいた滴
	KeyI: 0.1, // い: 小さく高い
	KeyU: 0.6, // う: ややこもる
	KeyE: 0.35, // え: 中くらいでやや高め
	KeyO: 0.95, // お: いちばん丸く低い
};

/** キーリピート時の連射を抑える最小間隔 */
const MIN_INTERVAL_MS = 40;

/** 木琴の音階: ド(C4)〜ミ(E5)。キーボードの縦の列に左→右で割り当てる */
const MARIMBA_SCALE = [
	261.63, // ド  C4
	293.66, // レ  D4
	329.63, // ミ  E4
	349.23, // ファ F4
	392.0, //  ソ  G4
	440.0, //  ラ  A4
	493.88, // シ  B4
	523.25, // ド  C5
	587.33, // レ  D5
	659.25, // ミ  E5
];

/**
 * 物理キー(event.code) → 縦の列番号。
 * 同じ列（例: Q・A・Z）はすべて同じ音になる。
 * event.code は物理位置ベースなので日本語配列やIME変換中でも一貫する。
 */
const KEY_COLUMNS: Record<string, number> = {
	Digit1: 0, KeyQ: 0, KeyA: 0, KeyZ: 0,
	Digit2: 1, KeyW: 1, KeyS: 1, KeyX: 1,
	Digit3: 2, KeyE: 2, KeyD: 2, KeyC: 2,
	Digit4: 3, KeyR: 3, KeyF: 3, KeyV: 3,
	Digit5: 4, KeyT: 4, KeyG: 4, KeyB: 4,
	Digit6: 5, KeyY: 5, KeyH: 5, KeyN: 5,
	Digit7: 6, KeyU: 6, KeyJ: 6, KeyM: 6,
	Digit8: 7, KeyI: 7, KeyK: 7, Comma: 7,
	Digit9: 8, KeyO: 8, KeyL: 8, Period: 8,
	Digit0: 9, KeyP: 9, Semicolon: 9, Slash: 9,
};

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
	/** 水滴の「ため」。速い打鍵では数打ぶんたまってから落ちる */
	private dropFill = 0;
	private lastDropKeyAt = 0;

	constructor(private engine: AudioEngine) {}

	/** code = KeyboardEvent.code（木琴が列→音程の割り当てに使う） */
	play(kind: KeyKind, code?: string): void {
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
			case "drop2":
				this.playDrop2(kind, level, code);
				break;
			case "typewriter":
				this.playTypewriter(kind, level);
				break;
			case "marimba":
				this.playMarimba(kind, level, code);
				break;
			case "soft":
				this.playSoft(kind, level);
				break;
		}
	}

	/**
	 * 水滴。打鍵の速さで振る舞いが変わる:
	 * - ゆっくり（前の打鍵から500ms超）: 1打ごとに1滴落ちる
	 * - 速い: 打鍵ごとに雫が「たまり」、3〜4打（ランダム）で満ちて落ちる。
	 *   ため中は極小の「雫の気配」が鳴り、満ちるほど気配の音程が上がる
	 * - Enter/改行: たまった分も含めて大粒がひとつ落ちる（行の句読点）
	 * すべての音は打鍵の瞬間にだけ鳴るため、リズムはタイピングと常に同期する。
	 */
	private playDrop(kind: KeyKind, level: number): void {
		const now = performance.now();
		const gap = now - this.lastDropKeyAt;
		this.lastDropKeyAt = now;

		if (kind === "enter" || kind === "return") {
			this.dropFill = 0;
			this.fallDrop(rand(0.8, 1), 0.55, 0.26, level);
			return;
		}

		if (gap > 500) {
			// ゆっくりした打鍵。ためが残っていれば少し大きめの滴として落とす
			const pending = this.dropFill > 0.4;
			this.dropFill = 0;
			let size = Math.random();
			let freqScale = 1;
			let peak = 0.22;
			if (kind === "space") {
				size = rand(0.55, 0.85);
				freqScale = 0.62;
			} else if (kind === "delete") {
				size = rand(0, 0.3);
				peak = 0.16;
			}
			if (pending) size = Math.max(size, rand(0.5, 0.8));
			this.fallDrop(size, freqScale, peak, level);
			return;
		}

		// 速い打鍵: ためて、満ちたら落ちる
		this.dropFill += rand(0.26, 0.36);
		if (this.dropFill >= 1) {
			this.dropFill -= 1;
			this.fallDrop(rand(0.55, 0.9), kind === "space" ? 0.62 : 1, 0.24, level);
		} else {
			this.dropTick(kind, level);
		}
	}

	/**
	 * 水滴2: 母音キー(A/I/U/E/O)だけが滴を落とす。
	 * 母音ごとに滴の大きさが決まっていて（あ=大粒、い=小粒…）、
	 * 子音は沈黙するので、ことばの母音のリズムだけが残る。
	 */
	private playDrop2(kind: KeyKind, level: number, code?: string): void {
		if (kind === "enter" || kind === "return") {
			this.fallDrop(rand(0.8, 1), 0.55, 0.26, level); // 行の締めの大粒
			return;
		}
		if (kind === "space") {
			this.fallDrop(rand(0.5, 0.7), 0.62, 0.2, level); // 変換・区切りのやわらかい滴
			return;
		}
		if (kind === "delete") {
			this.fallDrop(rand(0.05, 0.2), 1, 0.13, level); // 削除は小さく控えめ
			return;
		}
		const size = code !== undefined ? VOWEL_DROP_SIZES[code] : undefined;
		if (size === undefined) return; // 子音・記号は沈黙
		this.fallDrop(Math.max(0, Math.min(1, size + rand(-0.07, 0.07))), 1, 0.22, level);
	}

	/** 1滴の落下音。size (0=小粒, 1=大粒) から音程・長さ・共鳴を連動させる */
	private fallDrop(size: number, freqScale: number, peak: number, level: number): void {
		const t = this.engine.context.currentTime;
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
		if (Math.random() < 0.28) {
			const f2 = freq * rand(1.15, 1.45);
			const d2 = dur * rand(0.5, 0.75);
			this.chirp(t + rand(0.045, 0.09), f2, f2 * rand(1.2, 1.5), d2 * 0.6, d2, peak * 0.4 * level);
		}
	}

	/** ため中の極小の「雫の気配」。満ちるほどわずかに音程が上がる */
	private dropTick(kind: KeyKind, level: number): void {
		const t = this.engine.context.currentTime;
		let f = lerp(1600, 2400, Math.min(this.dropFill, 1)) * rand(0.95, 1.05);
		if (kind === "delete") f *= 0.7; // 削除はすこし鈍い気配
		this.chirp(t, f, f * rand(1.05, 1.15), 0.02, 0.045, 0.06 * level);
		this.noiseHit(t, rand(3800, 5200), rand(0.006, 0.012), 0.03 * level);
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

	/**
	 * 木琴: 基音 + 4倍音の短いストライク。
	 * キーボードの縦の列ごとに音程が決まり（zの列=ド、xの列=レ…）、鍵盤のように弾ける。
	 */
	private playMarimba(kind: KeyKind, level: number, code?: string): void {
		let freq: number;
		let dur = 0.4;
		let peak = 0.22;
		if (kind === "space") {
			freq = 392.0; // ソ (G4)
			dur = 0.5;
		} else if (kind === "enter" || kind === "return") {
			freq = 130.81; // 1オクターブ低いド (C3) が行の締めとして響く
			dur = 0.9;
			peak = 0.26;
		} else if (kind === "delete") {
			freq = 220.0; // 低めのラ (A3) で「取り消し」の合図
			dur = 0.18;
			peak = 0.16;
		} else {
			const column = code !== undefined ? KEY_COLUMNS[code] : undefined;
			freq =
				column !== undefined
					? MARIMBA_SCALE[column]
					: MARIMBA_SCALE[Math.floor(Math.random() * MARIMBA_SCALE.length)];
		}
		freq *= rand(0.998, 1.002); // 実物の音板のようなごく僅かな揺らぎ
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
