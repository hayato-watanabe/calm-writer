import { BgmMoodId } from "../audio/bgm";

export type ParticleKind = "none" | "snow" | "stars" | "motes";

/**
 * シーン = 背景(CSS) × パーティクル × BGMムード の組。
 * 背景グラデーションと文字色は styles.css の
 * `.immersive-writer-scene-<id>` セレクタで定義する。
 */
export interface Scene {
	id: string;
	name: string;
	particles: ParticleKind;
	mood: BgmMoodId;
}

export const SCENES: Scene[] = [
	{ id: "snowfield", name: "雪原", particles: "snow", mood: "aurora" },
	{ id: "night", name: "夜空", particles: "stars", mood: "night" },
	{ id: "forest", name: "森", particles: "motes", mood: "forest" },
	{ id: "paper", name: "白い紙", particles: "none", mood: "calm" },
];

export function getScene(id: string): Scene {
	return SCENES.find((s) => s.id === id) ?? SCENES[0];
}
