import { Notice, Plugin } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { AudioEngine } from "./audio/engine";
import { KEY_SCHEMES, KeyKind, KeySchemeId, KeySoundPlayer } from "./audio/keySounds";
import { BgmMoodId, BgmPlayer } from "./audio/bgm";
import { ParticleLayer } from "./ambience/particles";
import { SkyCycle } from "./ambience/sky";
import { ZenController } from "./ambience/zenMode";
import { ZenPanel } from "./ambience/panel";
import { getScene, Scene, SCENES } from "./ambience/scenes";
import { ImmersiveWriterSettings, ImmersiveWriterSettingTab, DEFAULT_SETTINGS } from "./settings";

const CSS_VARS = [
	"--iw-font-family",
	"--iw-font-size",
	"--iw-line-height",
	"--iw-editor-width",
	"--iw-vignette",
] as const;

export default class ImmersiveWriterPlugin extends Plugin {
	settings!: ImmersiveWriterSettings;
	engine = new AudioEngine();
	keySounds = new KeySoundPlayer(this.engine);
	bgm = new BgmPlayer(this.engine);
	particles = new ParticleLayer();
	sky = new SkyCycle();
	panel = new ZenPanel(this);
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
		this.addSettingTab(new ImmersiveWriterSettingTab(this.app, this));
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
		this.applyAmbience(scene);
		if (this.settings.bgmEnabled && !this.bgm.playing) this.bgm.start(this.effectiveMood());
		this.panel.show();
		this.engine.resume();
	}

	exitZen(): void {
		if (!this.zen.active) return;
		this.zen.exit();
		this.panel.hide();
		this.sky.stop();
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
			this.applyAmbience(scene);
			// BGMがシーン連動のときだけムードを追従させる
			if (this.bgm.playing && this.settings.bgmMood === "auto") {
				this.bgm.switchMood(scene.mood);
			}
		}
		this.panel.refresh();
		if (notify) new Notice(`シーン: ${scene.name}`);
	}

	/** 空の時間経過とパーティクルを現在のシーン・設定に合わせて張り直す */
	private applyAmbience(scene: Scene): void {
		if (this.settings.nightCycle && scene.id === "night") this.sky.start();
		else this.sky.stop();
		if (this.settings.particlesEnabled) {
			this.particles.start(scene.particles, () => this.sky.state);
		} else {
			this.particles.stop();
		}
	}

	refreshAmbience(): void {
		if (!this.zen.active) return;
		this.applyAmbience(getScene(this.settings.sceneId));
	}

	// ---- 音 ----

	toggleBgm(): void {
		if (this.bgm.playing) {
			this.bgm.stop();
			new Notice("BGMを停止しました");
		} else {
			this.bgm.start(this.effectiveMood());
			new Notice("BGMを再生します");
		}
	}

	/** BGMのムード設定（シーン連動 or 固定）を実際のムードに解決する */
	effectiveMood(): BgmMoodId {
		return this.settings.bgmMood === "auto"
			? getScene(this.settings.sceneId).mood
			: this.settings.bgmMood;
	}

	/** BGMのON/OFF。オンにすると（没入モード中なら）すぐ再生が始まる */
	async setBgmEnabled(on: boolean): Promise<void> {
		this.settings.bgmEnabled = on;
		if (!on) this.bgm.stop();
		else if (this.zen.active && !this.bgm.playing) this.bgm.start(this.effectiveMood());
		await this.saveSettings();
		this.panel.refresh();
	}

	/** タイプ音のON/OFF。オンにするとサンプルを1音鳴らす */
	async setKeySoundsEnabled(on: boolean): Promise<void> {
		this.settings.keySoundsEnabled = on;
		if (on) this.keySounds.play("key", "KeyA");
		await this.saveSettings();
		this.panel.refresh();
	}

	/** パネルからのBGMムード切り替え */
	async setBgmChoice(choice: "auto" | BgmMoodId): Promise<void> {
		this.settings.bgmMood = choice;
		const mood = this.effectiveMood();
		if (this.bgm.playing) this.bgm.switchMood(mood);
		else if (this.settings.bgmEnabled && this.zen.active) this.bgm.start(mood);
		await this.saveSettings();
		this.panel.refresh();
	}

	/** パネルからの打鍵音の音色切り替え。サンプルを鳴らす */
	async setKeySoundChoice(choice: KeySchemeId): Promise<void> {
		this.settings.keySoundScheme = choice;
		this.applyAudioSettings();
		this.keySounds.play("key", "KeyA"); // 母音扱いで試聴
		await this.saveSettings();
		this.panel.refresh();
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
		if (kind) this.keySounds.play(kind, e.code);
	}

	// ---- 表示 ----

	applyCssVars(): void {
		const s = this.settings;
		const st = document.body.style;
		const font = s.customFont.trim() || s.fontPreset || "inherit";
		st.setProperty("--iw-font-family", font);
		st.setProperty("--iw-font-size", `${s.fontSize}px`);
		st.setProperty("--iw-line-height", String(s.lineHeight));
		st.setProperty("--iw-editor-width", `${s.editorWidth}rem`);
		st.setProperty("--iw-vignette", String(s.vignette));
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
		// 廃止された音色（旧: ソフトなど）が保存されていたら既定に戻す
		if (!(this.settings.keySoundScheme in KEY_SCHEMES)) {
			this.settings.keySoundScheme = "drop";
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/** キーイベントを音の種類へ振り分ける。音を鳴らさないキーは null */
function classifyKey(e: KeyboardEvent): KeyKind | null {
	if (e.key === "Enter") {
		// IMEの変換確定Enterは従来のEnter音、実際の改行はキャリッジリターン音
		return e.isComposing || e.keyCode === 229 ? "enter" : "return";
	}
	if (e.key === " " || e.key === "Spacebar") return "space";
	if (e.key === "Backspace" || e.key === "Delete") return "delete";
	// 日本語IMEの変換中でも打鍵ごとに音を返す
	if (e.key === "Process" || e.isComposing) return "key";
	if (e.key.length === 1) return "key";
	return null;
}
