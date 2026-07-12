import { SCENES } from "./scenes";
import { BGM_MOOD_NAMES, BgmMoodId } from "../audio/bgm";
import { KEY_SCHEMES, KeySchemeId } from "../audio/keySounds";
import type ImmersiveWriterPlugin from "../main";

/**
 * 没入モード中に画面右端へ出す切り替えパネル。
 * ふだんは細いバーがうっすら見えるだけで、マウスを重ねると
 * 背景・BGM・打鍵音のセレクタが浮かび上がる。
 */
export class ZenPanel {
	private root: HTMLElement | null = null;

	constructor(private plugin: ImmersiveWriterPlugin) {}

	show(): void {
		this.hide();
		const root = document.body.createDiv({ cls: "immersive-writer-panel" });
		root.createDiv({ cls: "immersive-writer-panel-hint" });
		const body = root.createDiv({ cls: "immersive-writer-panel-body" });

		const scenes = this.section(body, "背景");
		for (const scene of SCENES) {
			this.option(scenes, scene.name, "scene", scene.id, () => {
				void this.plugin.setScene(scene.id, false);
			});
		}

		const bgm = this.section(body, "BGM");
		this.option(bgm, "シーン連動", "bgm", "auto", () => {
			void this.plugin.setBgmChoice("auto");
		});
		for (const [id, name] of Object.entries(BGM_MOOD_NAMES)) {
			this.option(bgm, name, "bgm", id, () => {
				void this.plugin.setBgmChoice(id as BgmMoodId);
			});
		}
		this.option(bgm, "オフ", "bgm", "off", () => {
			void this.plugin.setBgmChoice("off");
		});

		const keys = this.section(body, "打鍵音");
		for (const [id, name] of Object.entries(KEY_SCHEMES)) {
			this.option(keys, name, "key", id, () => {
				void this.plugin.setKeySoundChoice(id as KeySchemeId);
			});
		}
		this.option(keys, "オフ", "key", "off", () => {
			void this.plugin.setKeySoundChoice("off");
		});

		this.root = root;
		this.refresh();
	}

	hide(): void {
		this.root?.remove();
		this.root = null;
	}

	/** 現在の設定に合わせて選択中ハイライトを付け直す */
	refresh(): void {
		if (!this.root) return;
		const s = this.plugin.settings;
		const active: Record<string, string> = {
			scene: s.sceneId,
			bgm: s.bgmEnabled ? s.bgmMood : "off",
			key: s.keySoundsEnabled ? s.keySoundScheme : "off",
		};
		const options = this.root.querySelectorAll<HTMLButtonElement>(".immersive-writer-panel-option");
		options.forEach((el) => {
			el.classList.toggle("is-active", active[el.dataset.group ?? ""] === el.dataset.value);
		});
	}

	private section(parent: HTMLElement, title: string): HTMLElement {
		const sec = parent.createDiv({ cls: "immersive-writer-panel-section" });
		sec.createDiv({ cls: "immersive-writer-panel-title", text: title });
		return sec;
	}

	private option(
		parent: HTMLElement,
		label: string,
		group: string,
		value: string,
		onSelect: () => void
	): void {
		const btn = parent.createEl("button", { cls: "immersive-writer-panel-option", text: label });
		btn.dataset.group = group;
		btn.dataset.value = value;
		// mousedownを潰してエディタからフォーカスを奪わない
		btn.addEventListener("mousedown", (e) => e.preventDefault());
		btn.addEventListener("click", () => {
			onSelect();
			this.refresh();
		});
	}
}
