import { Notice, Plugin } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { AudioEngine } from "./audio/engine";
import { KeyKind, KeySoundPlayer } from "./audio/keySounds";
import { BgmPlayer } from "./audio/bgm";
import { ParticleLayer } from "./ambience/particles";
import { ZenController } from "./ambience/zenMode";
import { getScene, SCENES } from "./ambience/scenes";
import { CalmWriterSettings, CalmWriterSettingTab, DEFAULT_SETTINGS } from "./settings";

const CSS_VARS = [
	"--calm-font-family",
	"--calm-font-size",
	"--calm-line-height",
	"--calm-editor-width",
	"--calm-vignette",
] as const;

export default class CalmWriterPlugin extends Plugin {
	settings!: CalmWriterSettings;
	engine = new AudioEngine();
	keySounds = new KeySoundPlayer(this.engine);
	bgm = new BgmPlayer(this.engine);
	particles = new ParticleLayer();
	zen!: ZenController;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.zen = new ZenController(this.app);
		this.applyAudioSettings();
		this.applyCssVars();

		this.addRibbonIcon("mountain-snow", "没入モードを切り替え", () => this.toggleZen());

		this.addCommand({
			id: "toggle-zen",
			name: "没入モードを切り替え",
			callback: () => this.toggleZen(),
		});
		this.addCommand({
			id: "toggle-key-sounds",
			name: "タイプ音のオン/オフ",
			callback: async () => {
				this.settings.keySoundsEnabled = !this.settings.keySoundsEnabled;
				await this.saveSettings();
				new Notice(this.settings.keySoundsEnabled ? "タイプ音: オン" : "タイプ音: オフ");
			},
		});
		this.addCommand({
			id: "toggle-bgm",
			name: "BGMの再生/停止",
			callback: () => this.toggleBgm(),
		});
		this.addCommand({
			id: "next-scene",
			name: "次のシーンへ切り替え",
			callback: async () => {
				const idx = SCENES.findIndex((sc) => sc.id === this.settings.sceneId);
				const next = SCENES[(idx + 1) % SCENES.length];
				await this.setScene(next.id, true);
			},
		});

		this.registerDomEvent(document, "keydown", (e) => this.onKeyDown(e), { capture: true });

		// フルスクリーンをEscなどで抜けたら没入モードも終了する
		this.registerDomEvent(document, "fullscreenchange", () => {
			if (this.zen.active && this.zen.enteredFullscreen && !document.fullscreenElement) {
				this.exitZen();
			}
		});

		this.registerEditorExtension(this.typewriterExtension());
		this.addSettingTab(new CalmWriterSettingTab(this.app, this));
	}

	onunload(): void {
		this.exitZen();
		this.bgm.dispose();
		this.particles.stop();
		this.engine.dispose();
		for (const v of CSS_VARS) document.body.style.removeProperty(v);
	}

	// ---- 没入モード ----

	toggleZen(): void {
		if (this.zen.active) this.exitZen();
		else this.enterZen();
	}

	enterZen(): void {
		const scene = getScene(this.settings.sceneId);
		this.zen.enter(scene.id, this.settings.fullscreen);
		if (this.settings.particlesEnabled) this.particles.start(scene.particles);
		if (this.settings.bgmEnabled && !this.bgm.playing) this.bgm.start(scene.mood);
		this.engine.resume();
	}

	exitZen(): void {
		if (!this.zen.active) return;
		this.zen.exit();
		this.particles.stop();
		this.bgm.stop();
	}

	/** シーンを保存し、没入モード中なら見た目と音を即座に反映する */
	async setScene(sceneId: string, notify: boolean): Promise<void> {
		this.settings.sceneId = sceneId;
		await this.saveSettings();
		const scene = getScene(sceneId);
		if (this.zen.active) {
			this.zen.applyScene(scene.id);
			this.refreshParticles();
			this.bgm.switchMood(scene.mood);
		}
		if (notify) new Notice(`シーン: ${scene.name}`);
	}

	refreshParticles(): void {
		if (!this.zen.active) return;
		if (this.settings.particlesEnabled) {
			this.particles.start(getScene(this.settings.sceneId).particles);
		} else {
			this.particles.stop();
		}
	}

	// ---- 音 ----

	toggleBgm(): void {
		if (this.bgm.playing) {
			this.bgm.stop();
			new Notice("BGMを停止しました");
		} else {
			this.bgm.start(getScene(this.settings.sceneId).mood);
			new Notice("BGMを再生します");
		}
	}

	applyAudioSettings(): void {
		this.keySounds.volume = this.settings.keySoundVolume;
		this.keySounds.scheme = this.settings.keySoundScheme;
		this.bgm.setVolume(this.settings.bgmVolume);
	}

	private onKeyDown(e: KeyboardEvent): void {
		const s = this.settings;
		if (!s.keySoundsEnabled) return;
		if (!this.zen.active && !s.keySoundsEverywhere) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;
		if (!target.closest(".cm-editor, .inline-title")) return;
		const kind = classifyKey(e);
		if (kind) this.keySounds.play(kind);
	}

	// ---- 表示 ----

	applyCssVars(): void {
		const s = this.settings;
		const st = document.body.style;
		const font = s.customFont.trim() || s.fontPreset || "inherit";
		st.setProperty("--calm-font-family", font);
		st.setProperty("--calm-font-size", `${s.fontSize}px`);
		st.setProperty("--calm-line-height", String(s.lineHeight));
		st.setProperty("--calm-editor-width", `${s.editorWidth}rem`);
		st.setProperty("--calm-vignette", String(s.vignette));
	}

	/** 入力した行を画面中央に保つCodeMirror拡張（没入モード中のみ動く） */
	private typewriterExtension() {
		return EditorView.updateListener.of((update: ViewUpdate) => {
			if (!update.docChanged) return;
			if (!this.zen.active || !this.settings.typewriterScroll) return;
			if (!update.view.hasFocus) return;
			const view = update.view;
			window.requestAnimationFrame(() => {
				try {
					view.dispatch({
						effects: EditorView.scrollIntoView(view.state.selection.main.head, {
							y: "center",
						}),
					});
				} catch {
					// エディタが破棄された直後などは無視する
				}
			});
		});
	}

	// ---- 設定 ----

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/** キーイベントを音の種類へ振り分ける。音を鳴らさないキーは null */
function classifyKey(e: KeyboardEvent): KeyKind | null {
	if (e.key === "Enter") return "enter";
	if (e.key === " " || e.key === "Spacebar") return "space";
	if (e.key === "Backspace" || e.key === "Delete") return "delete";
	// 日本語IMEの変換中でも打鍵ごとに音を返す
	if (e.key === "Process" || e.isComposing) return "key";
	if (e.key.length === 1) return "key";
	return null;
}
