import { SCENES } from "./scenes";
import { BGM_MOOD_NAMES, BgmMoodId } from "../audio/bgm";
import { KEY_SCHEMES, KeySchemeId } from "../audio/keySounds";
import type ImmersiveWriterPlugin from "../main";

/**
 * 没入モード中に画面右端へ出す切り替えパネル。
 * ふだんは細いバーがうっすら見えるだけで、マウスを重ねると
 * 背景・BGM・打鍵音のセレクタが浮かび上がる。
 * BGMと打鍵音はセクション見出しのスイッチでON/OFFでき、
 * OFFのあいだは配下の選択肢が非活性になる。
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

		const bgm = this.section(body, "BGM", "bgm", (on) => {
			void this.plugin.setBgmEnabled(on);
		});
		this.option(bgm, "シーン連動", "bgm", "auto", () => {
			void this.plugin.setBgmChoice("auto");
		});
		for (const [id, name] of Object.entries(BGM_MOOD_NAMES)) {
			this.option(bgm, name, "bgm", id, () => {
				void this.plugin.setBgmChoice(id as BgmMoodId);
			});
		}

		const keys = this.section(body, "打鍵音", "key", (on) => {
			void this.plugin.setKeySoundsEnabled(on);
		});
		for (const [id, name] of Object.entries(KEY_SCHEMES)) {
			this.option(keys, name, "key", id, () => {
				void this.plugin.setKeySoundChoice(id as KeySchemeId);
			});
		}

		this.root = root;
		this.refresh();
	}

	hide(): void {
		this.root?.remove();
		this.root = null;
	}

	/** 現在の設定に合わせてスイッチ・活性状態・選択中ハイライトを付け直す */
	refresh(): void {
		if (!this.root) return;
		const s = this.plugin.settings;

		const enabled: Record<string, boolean> = {
			bgm: s.bgmEnabled,
			key: s.keySoundsEnabled,
		};
		const switches = this.root.querySelectorAll<HTMLElement>(".immersive-writer-panel-switch");
		switches.forEach((sw) => {
			sw.classList.toggle("is-enabled", enabled[sw.dataset.switch ?? ""] ?? false);
		});
		const wraps = this.root.querySelectorAll<HTMLElement>(".immersive-writer-panel-options");
		wraps.forEach((wrap) => {
			const group = wrap.dataset.group ?? "";
			wrap.classList.toggle("is-disabled", group in enabled && !enabled[group]);
		});

		const active: Record<string, string> = {
			scene: s.sceneId,
			bgm: s.bgmMood,
			key: s.keySoundScheme,
		};
		const options = this.root.querySelectorAll<HTMLButtonElement>(".immersive-writer-panel-option");
		options.forEach((el) => {
			el.classList.toggle("is-active", active[el.dataset.group ?? ""] === el.dataset.value);
		});
	}

	/**
	 * セクションを作り、選択肢の入れ物を返す。
	 * toggleGroup を渡すと見出し右端にON/OFFスイッチが付く。
	 */
	private section(
		parent: HTMLElement,
		title: string,
		toggleGroup?: string,
		onToggle?: (on: boolean) => void
	): HTMLElement {
		const sec = parent.createDiv({ cls: "immersive-writer-panel-section" });
		const head = sec.createDiv({ cls: "immersive-writer-panel-head" });
		head.createDiv({ cls: "immersive-writer-panel-title", text: title });
		if (toggleGroup && onToggle) {
			// Obsidian標準のトグル見た目 (checkbox-container) を借りる
			const sw = head.createDiv({ cls: "checkbox-container mod-small immersive-writer-panel-switch" });
			sw.dataset.switch = toggleGroup;
			sw.createEl("input", { attr: { type: "checkbox", tabindex: "-1" } });
			sw.addEventListener("mousedown", (e) => e.preventDefault());
			sw.addEventListener("click", () => {
				onToggle(!sw.classList.contains("is-enabled"));
			});
		}
		const options = sec.createDiv({ cls: "immersive-writer-panel-options" });
		if (toggleGroup) options.dataset.group = toggleGroup;
		return options;
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
