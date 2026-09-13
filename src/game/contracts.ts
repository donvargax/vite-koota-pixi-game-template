import type { Key } from "../ecs/di.ts";

export interface InputPort {
	moveAxis(): number;
	consumeJumpPressed(): boolean;
	isShootHeld(): boolean;
}

export interface AudioPort {
	play(sound: string, volume?: number): void;
}

export interface RandomPort {
	next(): number;
}

// fallow-ignore-next-line unused-export
export const IInput = Symbol("InputPort") as Key<InputPort>;
// fallow-ignore-next-line unused-export
export const IAudio = Symbol("AudioPort") as Key<AudioPort>;
// fallow-ignore-next-line unused-export
export const IRandom = Symbol("RandomPort") as Key<RandomPort>;
