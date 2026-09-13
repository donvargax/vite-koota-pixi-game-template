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
