import type { AudioPort, Direction2D, InputPort } from "./contracts.ts";

export class FakeInput implements InputPort {
	axis = 0;
	aim: Direction2D = { x: 0, y: 0 };
	jumpPressed = false;
	shootHeld = false;
	dashPressed = false;

	moveAxis(): number {
		return this.axis;
	}

	aimAxis(): Direction2D {
		return this.aim;
	}

	consumeJumpPressed(): boolean {
		const pressed = this.jumpPressed;
		this.jumpPressed = false;
		return pressed;
	}

	isShootHeld(): boolean {
		return this.shootHeld;
	}

	consumeDashPressed(): boolean {
		const pressed = this.dashPressed;
		this.dashPressed = false;
		return pressed;
	}
}

export class FakeAudio implements AudioPort {
	readonly played: Array<{ sound: string; volume: number | undefined }> = [];

	play(sound: string, volume?: number): void {
		this.played.push({ sound, volume });
	}
}
