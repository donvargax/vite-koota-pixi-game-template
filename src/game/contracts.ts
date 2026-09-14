export interface Direction2D {
	readonly x: number;
	readonly y: number;
}

export interface InputPort {
	moveAxis(): number;
	aimAxis(): Direction2D;
	consumeJumpPressed(): boolean;
	consumeDashPressed(): boolean;
	isShootHeld(): boolean;
}

export interface AudioPort {
	play(sound: string, volume?: number): void;
}

export interface RandomPort {
	next(): number;
}
