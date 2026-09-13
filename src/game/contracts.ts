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

export const IInput = Symbol("InputPort") as Key<InputPort>;
export const IAudio = Symbol("AudioPort") as Key<AudioPort>;
export const IRandom = Symbol("RandomPort") as Key<RandomPort>;
