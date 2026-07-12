import { App } from "obsidian";

const ZEN_CLASS = "calm-writer-zen";
const SCENE_CLASS_PREFIX = "calm-writer-scene-";

/**
 * 没入モードの入退場を管理する。
 * - body へのクラス付与（styles.css がそれを見てUIを隠し背景を敷く）
 * - サイドバーの折りたたみと復元
 * - フルスクリーンへの移行と復帰
 */
export class ZenController {
	active = false;
	/** このプラグインがフルスクリーンに入れたかどうか（自前で入れた時だけ抜ける） */
	enteredFullscreen = false;
	private leftWasExpanded = false;
	private rightWasExpanded = false;

	constructor(private app: App) {}

	enter(sceneId: string, fullscreen: boolean): void {
		if (this.active) return;
		this.active = true;

		document.body.classList.add(ZEN_CLASS, SCENE_CLASS_PREFIX + sceneId);

		// ゆっくり明けるフェード演出
		const fade = document.body.createDiv({ cls: "calm-writer-fade" });
		window.setTimeout(() => fade.remove(), 1300);

		// サイドバーを畳む（leftSplit/rightSplit は公開型に無いので any 経由）
		const ws = this.app.workspace as unknown as {
			leftSplit?: { collapsed: boolean; collapse(): void; expand(): void };
			rightSplit?: { collapsed: boolean; collapse(): void; expand(): void };
		};
		this.leftWasExpanded = ws.leftSplit ? !ws.leftSplit.collapsed : false;
		this.rightWasExpanded = ws.rightSplit ? !ws.rightSplit.collapsed : false;
		ws.leftSplit?.collapse();
		ws.rightSplit?.collapse();

		if (fullscreen && !document.fullscreenElement) {
			this.enteredFullscreen = true;
			document.documentElement.requestFullscreen().catch(() => {
				this.enteredFullscreen = false;
			});
		}
	}

	/** 没入モード中のシーン差し替え */
	applyScene(sceneId: string): void {
		if (!this.active) return;
		this.removeSceneClasses();
		document.body.classList.add(SCENE_CLASS_PREFIX + sceneId);
	}

	exit(): void {
		if (!this.active) return;
		this.active = false;

		document.body.classList.remove(ZEN_CLASS);
		this.removeSceneClasses();

		const ws = this.app.workspace as unknown as {
			leftSplit?: { expand(): void };
			rightSplit?: { expand(): void };
		};
		if (this.leftWasExpanded) ws.leftSplit?.expand();
		if (this.rightWasExpanded) ws.rightSplit?.expand();

		if (this.enteredFullscreen) {
			this.enteredFullscreen = false;
			if (document.fullscreenElement) {
				document.exitFullscreen().catch(() => {
					// フルスクリーン解除に失敗しても他の後始末は済んでいる
				});
			}
		}
	}

	private removeSceneClasses(): void {
		for (const cls of Array.from(document.body.classList)) {
			if (cls.startsWith(SCENE_CLASS_PREFIX)) document.body.classList.remove(cls);
		}
	}
}
