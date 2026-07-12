/**
 * Web Audio の共有基盤。
 * AudioContext は生成コストがあるため、プラグイン全体でひとつを使い回す。
 */
export class AudioEngine {
	private ctx: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private noise: AudioBuffer | null = null;

	get context(): AudioContext {
		if (!this.ctx) {
			this.ctx = new AudioContext();
			this.masterGain = this.ctx.createGain();
			this.masterGain.gain.value = 1;
			this.masterGain.connect(this.ctx.destination);
		}
		return this.ctx;
	}

	/** すべての音の出口。タイプ音・BGMはここへつなぐ */
	get output(): GainNode {
		void this.context;
		return this.masterGain as GainNode;
	}

	/** ユーザー操作を起点に呼び、サスペンド状態の AudioContext を起こす */
	resume(): void {
		if (this.ctx && this.ctx.state === "suspended") {
			void this.ctx.resume();
		}
	}

	/**
	 * 各シンセで使い回すホワイトノイズバッファ（2秒）。
	 * ループ再生時に周期が耳につかないよう、ある程度の長さを確保する。
	 */
	get noiseBuffer(): AudioBuffer {
		const ctx = this.context;
		if (!this.noise) {
			const len = Math.floor(ctx.sampleRate * 2);
			const buf = ctx.createBuffer(1, len, ctx.sampleRate);
			const data = buf.getChannelData(0);
			for (let i = 0; i < len; i++) {
				data[i] = Math.random() * 2 - 1;
			}
			this.noise = buf;
		}
		return this.noise;
	}

	/** 残響用のインパルス応答（指数減衰するステレオノイズ）を生成する */
	createReverbImpulse(seconds = 4, decay = 2.8): AudioBuffer {
		const ctx = this.context;
		const len = Math.floor(ctx.sampleRate * seconds);
		const buf = ctx.createBuffer(2, len, ctx.sampleRate);
		for (let ch = 0; ch < 2; ch++) {
			const data = buf.getChannelData(ch);
			for (let i = 0; i < len; i++) {
				data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
			}
		}
		return buf;
	}

	dispose(): void {
		if (this.ctx) {
			void this.ctx.close();
			this.ctx = null;
			this.masterGain = null;
			this.noise = null;
		}
	}
}
