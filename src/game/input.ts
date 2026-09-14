import type { Direction2D, InputPort } from "./contracts.ts";

type InputTarget = Pick<Window, "addEventListener" | "removeEventListener">;

const movementCodes = ["ArrowLeft", "ArrowRight", "ArrowUp", "Space"];
const jumpCodes = ["ArrowUp"];
const dashCodes = ["ShiftLeft", "ShiftRight"];
const shootCodes = ["Space", "KeyJ"];

export class KeyboardInput implements InputPort {
	private readonly down = new Set<string>();
	private jumpPressed = false;
	private dashPressed = false;
	private bound = false;

	private readonly onKeyDown = (event: Event): void => {
		const { code, repeat } = event as KeyboardEvent;
		if (movementCodes.includes(code)) event.preventDefault();
		if (!repeat && !this.down.has(code) && jumpCodes.includes(code)) this.jumpPressed = true;
		if (!repeat && !this.down.has(code) && dashCodes.includes(code)) this.dashPressed = true;
		this.down.add(code);
	};

	private readonly onKeyUp = (event: Event): void => {
		this.down.delete((event as KeyboardEvent).code);
	};

	private readonly onBlur = (): void => {
		this.down.clear();
		this.jumpPressed = false;
		this.dashPressed = false;
	};

	constructor(private readonly target: InputTarget = window) {}

	bind(): void {
		if (this.bound) return;
		this.target.addEventListener("keydown", this.onKeyDown);
		this.target.addEventListener("keyup", this.onKeyUp);
		this.target.addEventListener("blur", this.onBlur);
		this.bound = true;
	}

	dispose(): void {
		if (this.bound) {
			this.target.removeEventListener("keydown", this.onKeyDown);
			this.target.removeEventListener("keyup", this.onKeyUp);
			this.target.removeEventListener("blur", this.onBlur);
			this.bound = false;
		}
		this.onBlur();
	}

	moveAxis(): number {
		return (this.isDown("ArrowRight") ? 1 : 0) - (this.isDown("ArrowLeft") ? 1 : 0);
	}

	aimAxis(): Direction2D {
		return {
			x: (this.isDown("KeyD") ? 1 : 0) - (this.isDown("KeyA") ? 1 : 0),
			y: (this.isDown("KeyW") ? 1 : 0) - (this.isDown("KeyS") ? 1 : 0),
		};
	}

	consumeJumpPressed(): boolean {
		const pressed = this.jumpPressed;
		this.jumpPressed = false;
		return pressed;
	}

	consumeDashPressed(): boolean {
		const pressed = this.dashPressed;
		this.dashPressed = false;
		return pressed;
	}

	isShootHeld(): boolean {
		return shootCodes.some((code) => this.isDown(code));
	}

	private isDown(code: string): boolean {
		return this.down.has(code);
	}
}
