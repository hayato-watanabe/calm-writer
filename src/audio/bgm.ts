import { AudioEngine } from "./engine";

export type BgmMoodId = "aurora" | "night" | "forest" | "calm";

interface MoodDef {
	/** 基音の周波数(Hz) */
	root: number;
	/** 基音からの半音オフセットで表したコード進行 */
	chords: number[][];
	/** ローパスフィルターのカットオフ。低いほど暗くこもった音になる */
	cutoff: number;
	/** 風ノイズの量 0..1 */
	wind: number;
	/** ムードごとの音量補正 */
	level: number;
}

const MOODS: Record<BgmMoodId, MoodDef> = {
	// 雪原: Dメジャー系の明るく開けたパッド
	aurora: {
		root: 146.83, // D3
		chords: [
			[0, 7, 12, 16, 19], // D A D F# A
			[-7, 5, 9, 14], // Gadd9
			[-5, 2, 7, 16], // Asus系
		],
		cutoff: 950,
		wind: 0.5,
		level: 1,
	},
	// 夜空: Aマイナーの静かな進行
	night: {
		root: 110, // A2
		chords: [
			[0, 3, 7, 12], // Am
			[-4, 3, 8, 15], // F
			[-2, 5, 10, 14], // G
		],
		cutoff: 680,
		wind: 0.25,
		level: 1,
	},
	// 森: メジャーセブンスの温かい響き
	forest: {
		root: 130.81, // C3
		chords: [
			[0, 7, 11, 16], // Cmaj7
			[-3, 4, 7, 12], // Am7
			[-7, 5, 9, 12], // F
		],
		cutoff: 800,
		wind: 0.35,
		level: 0.95,
	},
	// 白い紙: ほとんど動かない最小限のドローン
	calm: {
		root: 174.61, // F3
		chords: [
			[0, 7, 12],
			[0, 5, 12],
		],
		cutoff: 640,
		wind: 0.15,
		level: 0.7,
	},
};

/** パネルや設定画面で使うムードの表示名 */
export const BGM_MOOD_NAMES: Record<BgmMoodId, string> = {
	aurora: "オーロラ",
	night: "夜",
	forest: "森",
	calm: "凪",
};

interface Voice {
	gain: GainNode;
	tail: AudioNode[]; // 後始末で切断するノード
	sources: { stop(when?: number): void }[];
}

/**
 * アンビエントドローンをリアルタイム生成するBGMプレイヤー。
 * デチューンした三角波の声部 + ゆっくりしたLFOの揺らぎ + 風ノイズ + 生成リバーブで、
 * 音源ファイルなしに終わりのない幻想的なパッドを作る。
 * コードは20〜35秒ごとにゆっくりクロスフェードで移り変わる。
 */
export class BgmPlayer {
	playing = false;
	private mood: BgmMoodId = "calm";
	private volume = 0.4;
	private master: GainNode | null = null;
	private padBus: GainNode | null = null;
	private voices: Voice[] = [];
	private wind: Voice | null = null;
	private chordIndex = 0;
	private timers = new Set<number>();

	constructor(private engine: AudioEngine) {}

	setVolume(v: number): void {
		this.volume = v;
		if (this.master) {
			const t = this.engine.context.currentTime;
			this.master.gain.cancelScheduledValues(t);
			this.master.gain.setTargetAtTime(v * v, t, 0.3);
		}
	}

	start(mood: BgmMoodId): void {
		if (this.playing) this.stop(0.3);
		const ctx = this.engine.context;
		this.engine.resume();
		this.mood = mood;
		const def = MOODS[mood];
		this.playing = true;

		this.master = ctx.createGain();
		this.master.gain.value = 0;
		this.master.connect(this.engine.output);

		const filter = ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = def.cutoff;
		filter.Q.value = 0.3;

		this.padBus = ctx.createGain();
		this.padBus.gain.value = def.level;
		this.padBus.connect(filter);

		// ドライ + リバーブ(ウェット)の二系統で奥行きを出す
		filter.connect(this.master);
		const convolver = ctx.createConvolver();
		convolver.buffer = this.engine.createReverbImpulse(4, 2.8);
		const wet = ctx.createGain();
		wet.gain.value = 0.6;
		filter.connect(convolver);
		convolver.connect(wet);
		wet.connect(this.master);

		this.chordIndex = 0;
		this.spawnChord(def.chords[0], 6);
		this.wind = this.createWindVoice(def);

		const t = ctx.currentTime;
		this.master.gain.setValueAtTime(0, t);
		this.master.gain.linearRampToValueAtTime(this.volume * this.volume, t + 4);

		this.scheduleChordChange();
	}

	stop(fadeSeconds = 2.5): void {
		this.playing = false;
		const master = this.master;
		if (!master) return;
		// フィールドを即座に手放し、フェード完了後に旧グラフだけを止める
		// （フェード中に start() し直しても新しいグラフと干渉しない）
		const voices = this.voices;
		const wind = this.wind;
		this.master = null;
		this.padBus = null;
		this.voices = [];
		this.wind = null;

		const ctx = this.engine.context;
		const t = ctx.currentTime;
		master.gain.cancelScheduledValues(t);
		master.gain.setValueAtTime(master.gain.value, t);
		master.gain.linearRampToValueAtTime(0, t + Math.max(fadeSeconds, 0.05));

		const timer = window.setTimeout(() => {
			this.timers.delete(timer);
			const all = wind ? [...voices, wind] : voices;
			for (const v of all) this.killVoice(v);
			master.disconnect();
		}, fadeSeconds * 1000 + 150);
		this.timers.add(timer);
	}

	get currentMood(): BgmMoodId {
		return this.mood;
	}

	/** シーン切替時などにムードを入れ替える（短いフェードを挟む） */
	switchMood(mood: BgmMoodId): void {
		if (this.playing && this.mood === mood) return;
		this.mood = mood;
		if (!this.playing) return;
		this.stop(1.2);
		const timer = window.setTimeout(() => {
			this.timers.delete(timer);
			this.start(mood);
		}, 1400);
		this.timers.add(timer);
	}

	dispose(): void {
		for (const id of this.timers) window.clearTimeout(id);
		this.timers.clear();
		this.stop(0);
	}

	// ---- 内部実装 ----

	private spawnChord(offsets: number[], fadeIn: number): void {
		const def = MOODS[this.mood];
		// ルートの1オクターブ下にサブベースを足す
		const tones = [offsets[0] - 12, ...offsets];
		for (let i = 0; i < tones.length; i++) {
			const freq = def.root * Math.pow(2, tones[i] / 12);
			const isSub = i === 0;
			const level = isSub ? 0.1 : 0.07;
			this.voices.push(this.createPadVoice(freq, level, fadeIn, isSub));
		}
	}

	private createPadVoice(freq: number, level: number, fadeIn: number, isSub: boolean): Voice {
		const ctx = this.engine.context;
		const t = ctx.currentTime;

		const osc1 = ctx.createOscillator();
		osc1.type = isSub ? "sine" : "triangle";
		osc1.frequency.value = freq;
		const osc2 = ctx.createOscillator();
		osc2.type = "sine";
		osc2.frequency.value = freq;
		osc2.detune.value = 6; // わずかなデチューンでうねりを作る

		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(level, t + fadeIn * (0.8 + Math.random() * 0.4));

		// 音量がゆっくり寄せては返すLFO
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 0.03 + Math.random() * 0.06;
		const lfoGain = ctx.createGain();
		lfoGain.gain.value = level * 0.3;
		lfo.connect(lfoGain);
		lfoGain.connect(gain.gain);

		const pan = ctx.createStereoPanner();
		pan.pan.value = isSub ? 0 : (Math.random() * 2 - 1) * 0.5;

		osc1.connect(gain);
		osc2.connect(gain);
		gain.connect(pan);
		pan.connect(this.padBus as GainNode);
		osc1.start(t);
		osc2.start(t);
		lfo.start(t);

		return { gain, tail: [gain, lfoGain, pan], sources: [osc1, osc2, lfo] };
	}

	private createWindVoice(def: MoodDef): Voice {
		const ctx = this.engine.context;
		const t = ctx.currentTime;

		const src = ctx.createBufferSource();
		src.buffer = this.engine.noiseBuffer;
		src.loop = true;

		const filter = ctx.createBiquadFilter();
		filter.type = "bandpass";
		filter.frequency.value = 400;
		filter.Q.value = 0.6;

		// フィルターの中心周波数を揺らして風の「うねり」を出す
		const freqLfo = ctx.createOscillator();
		freqLfo.frequency.value = 0.05;
		const freqLfoGain = ctx.createGain();
		freqLfoGain.gain.value = 180;
		freqLfo.connect(freqLfoGain);
		freqLfoGain.connect(filter.frequency);

		const gain = ctx.createGain();
		const level = def.wind * 0.06;
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(level, t + 8);
		const ampLfo = ctx.createOscillator();
		ampLfo.frequency.value = 0.07;
		const ampLfoGain = ctx.createGain();
		ampLfoGain.gain.value = level * 0.5;
		ampLfo.connect(ampLfoGain);
		ampLfoGain.connect(gain.gain);

		src.connect(filter);
		filter.connect(gain);
		gain.connect(this.padBus as GainNode);
		src.start(t);
		freqLfo.start(t);
		ampLfo.start(t);

		return { gain, tail: [gain, ampLfoGain, freqLfoGain, filter], sources: [src, freqLfo, ampLfo] };
	}

	private scheduleChordChange(): void {
		const timer = window.setTimeout(() => {
			this.timers.delete(timer);
			if (!this.playing || !this.padBus) return;
			this.nextChord();
			this.scheduleChordChange();
		}, 22000 + Math.random() * 14000);
		this.timers.add(timer);
	}

	private nextChord(): void {
		const ctx = this.engine.context;
		const def = MOODS[this.mood];
		const t = ctx.currentTime;
		const fade = 8;

		const old = this.voices;
		this.voices = [];
		for (const v of old) {
			v.gain.gain.cancelScheduledValues(t);
			v.gain.gain.setValueAtTime(v.gain.gain.value, t);
			v.gain.gain.linearRampToValueAtTime(0, t + fade);
			for (const s of v.sources) s.stop(t + fade + 0.5);
		}
		const timer = window.setTimeout(() => {
			this.timers.delete(timer);
			for (const v of old) this.killVoice(v);
		}, (fade + 1) * 1000);
		this.timers.add(timer);

		this.chordIndex = (this.chordIndex + 1) % def.chords.length;
		this.spawnChord(def.chords[this.chordIndex], fade);
	}

	private killVoice(v: Voice): void {
		for (const s of v.sources) {
			try {
				s.stop();
			} catch {
				// すでに停止済みなら何もしない
			}
		}
		for (const n of v.tail) n.disconnect();
	}
}
