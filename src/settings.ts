import { App, PluginSettingTab, Setting } from "obsidian";
import { KEY_SCHEMES, KeySchemeId } from "./audio/keySounds";
import { BGM_MOOD_NAMES, BgmMoodId } from "./audio/bgm";
import { SCENES } from "./ambience/scenes";
import type ImmersiveWriterPlugin from "./main";

export interface ImmersiveWriterSettings {
	sceneId: string;
	fullscreen: boolean;
	vignette: number; // 0..1
	particlesEnabled: boolean;
	nightCycle: boolean;
	typewriterScroll: boolean;
	keySoundsEnabled: boolean;
	keySoundsEverywhere: boolean;
	keySoundScheme: KeySchemeId;
	keySoundVolume: number; // 0..1
	bgmEnabled: boolean;
	bgmMood: "auto" | BgmMoodId; // auto = シーン連動
	bgmVolume: number; // 0..1
	fontPreset: string;
	customFont: string;
	fontSize: number; // px
	lineHeight: number;
	editorWidth: number; // rem
}

export const DEFAULT_SETTINGS: ImmersiveWriterSettings = {
	sceneId: "snowfield",
	fullscreen: true,
	vignette: 0.5,
	particlesEnabled: true,
	nightCycle: true,
	typewriterScroll: true,
	keySoundsEnabled: true,
	keySoundsEverywhere: false,
	keySoundScheme: "drop",
	keySoundVolume: 0.5,
	bgmEnabled: true,
	bgmMood: "auto",
	bgmVolume: 0.4,
	fontPreset: "",
	customFont: "",
	fontSize: 20,
	lineHeight: 2.0,
	editorWidth: 42,
};

/** フォントのプリセット。key = CSSのfont-family値, value = 表示名 */
const FONT_PRESETS: Record<string, string> = {
	"": "テーマの既定",
	'"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", serif': "明朝体",
	'"Hiragino Kaku Gothic ProN", "Yu Gothic", "YuGothic", "Noto Sans JP", sans-serif': "ゴシック体",
	'Georgia, "Iowan Old Style", "Times New Roman", serif': "欧文セリフ",
	'"SF Mono", Menlo, Consolas, "Source Han Code JP", monospace': "等幅",
};

export class ImmersiveWriterSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ImmersiveWriterPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		// ---- 没入モード ----
		new Setting(containerEl).setName("没入モード").setHeading();

		new Setting(containerEl)
			.setName("シーン")
			.setDesc("背景・BGM・パーティクルの組み合わせ。")
			.addDropdown((dd) => {
				for (const scene of SCENES) dd.addOption(scene.id, scene.name);
				dd.setValue(s.sceneId).onChange(async (v) => {
					await this.plugin.setScene(v, false);
				});
			});

		new Setting(containerEl)
			.setName("フルスクリーンにする")
			.setDesc("没入モード開始時に画面全体へ切り替えます。Escで解除できます。")
			.addToggle((tg) =>
				tg.setValue(s.fullscreen).onChange(async (v) => {
					s.fullscreen = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("周辺減光（ビネット）")
			.setDesc("画面の四隅をほんのり暗くして視線を中央に集めます。")
			.addSlider((sl) =>
				sl
					.setLimits(0, 100, 1)
					.setValue(Math.round(s.vignette * 100))
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.vignette = v / 100;
						this.plugin.applyCssVars();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("パーティクル")
			.setDesc("雪・星などの粒子演出を表示します。")
			.addToggle((tg) =>
				tg.setValue(s.particlesEnabled).onChange(async (v) => {
					s.particlesEnabled = v;
					this.plugin.refreshAmbience();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("夜空に時間の流れ")
			.setDesc("夕暮れから夜明けまでを約75分かけて描きます（実時間1分 = 作中10分）。月と流れ星も現れます。")
			.addToggle((tg) =>
				tg.setValue(s.nightCycle).onChange(async (v) => {
					s.nightCycle = v;
					this.plugin.refreshAmbience();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("タイプライタースクロール")
			.setDesc("入力中の行を常に画面の中央に保ちます（没入モード中のみ）。")
			.addToggle((tg) =>
				tg.setValue(s.typewriterScroll).onChange(async (v) => {
					s.typewriterScroll = v;
					await this.plugin.saveSettings();
				})
			);

		// ---- タイプ音 ----
		new Setting(containerEl).setName("タイプ音").setHeading();

		new Setting(containerEl)
			.setName("タイプ音を鳴らす")
			.addToggle((tg) =>
				tg.setValue(s.keySoundsEnabled).onChange(async (v) => {
					s.keySoundsEnabled = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("没入モード以外でも鳴らす")
			.setDesc("オフにすると没入モード中だけタイプ音が鳴ります。")
			.addToggle((tg) =>
				tg.setValue(s.keySoundsEverywhere).onChange(async (v) => {
					s.keySoundsEverywhere = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("音色")
			.setDesc("変更するとサンプルが鳴ります。")
			.addDropdown((dd) => {
				for (const [id, name] of Object.entries(KEY_SCHEMES)) dd.addOption(id, name);
				dd.setValue(s.keySoundScheme).onChange(async (v) => {
					s.keySoundScheme = v as KeySchemeId;
					this.plugin.applyAudioSettings();
					this.plugin.keySounds.play("key", "KeyA"); // 母音扱いで試聴
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("タイプ音の音量")
			.addSlider((sl) =>
				sl
					.setLimits(0, 100, 1)
					.setValue(Math.round(s.keySoundVolume * 100))
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.keySoundVolume = v / 100;
						this.plugin.applyAudioSettings();
						this.plugin.keySounds.play("key", "KeyA"); // 母音扱いで試聴
						await this.plugin.saveSettings();
					})
			);

		// ---- BGM ----
		new Setting(containerEl).setName("BGM").setHeading();

		new Setting(containerEl)
			.setName("没入モードでBGMを流す")
			.setDesc("シーンに合わせたアンビエントを自動再生します。コマンドで単独再生もできます。")
			.addToggle((tg) =>
				tg.setValue(s.bgmEnabled).onChange(async (v) => {
					s.bgmEnabled = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("BGMのムード")
			.setDesc("「シーン連動」はシーンに合わせて自動で選びます。")
			.addDropdown((dd) => {
				dd.addOption("auto", "シーン連動");
				for (const [id, name] of Object.entries(BGM_MOOD_NAMES)) dd.addOption(id, name);
				dd.setValue(s.bgmMood).onChange(async (v) => {
					s.bgmMood = v as ImmersiveWriterSettings["bgmMood"];
					if (this.plugin.bgm.playing) {
						this.plugin.bgm.switchMood(this.plugin.effectiveMood());
					}
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("BGMの音量")
			.addSlider((sl) =>
				sl
					.setLimits(0, 100, 1)
					.setValue(Math.round(s.bgmVolume * 100))
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.bgmVolume = v / 100;
						this.plugin.applyAudioSettings();
						await this.plugin.saveSettings();
					})
			);

		// ---- 文字と余白 ----
		new Setting(containerEl).setName("文字と余白（没入モード中）").setHeading();

		new Setting(containerEl)
			.setName("フォント")
			.addDropdown((dd) => {
				for (const [value, name] of Object.entries(FONT_PRESETS)) dd.addOption(value, name);
				dd.setValue(s.fontPreset in FONT_PRESETS ? s.fontPreset : "").onChange(async (v) => {
					s.fontPreset = v;
					this.plugin.applyCssVars();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("カスタムフォント")
			.setDesc("CSSのfont-family形式。入力するとプリセットより優先されます。")
			.addText((tx) =>
				tx
					.setPlaceholder('"Klee One", serif')
					.setValue(s.customFont)
					.onChange(async (v) => {
						s.customFont = v;
						this.plugin.applyCssVars();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("文字サイズ")
			.addSlider((sl) =>
				sl
					.setLimits(14, 30, 1)
					.setValue(s.fontSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.fontSize = v;
						this.plugin.applyCssVars();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("行の高さ")
			.addSlider((sl) =>
				sl
					.setLimits(1.4, 2.8, 0.1)
					.setValue(s.lineHeight)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.lineHeight = v;
						this.plugin.applyCssVars();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("本文の幅")
			.setDesc("単位: rem。小さいほど1行が短くなります。")
			.addSlider((sl) =>
				sl
					.setLimits(28, 60, 1)
					.setValue(s.editorWidth)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.editorWidth = v;
						this.plugin.applyCssVars();
						await this.plugin.saveSettings();
					})
			);
	}
}
