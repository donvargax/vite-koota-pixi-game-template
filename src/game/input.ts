import type { InputPort } from "./contracts.ts";

type InputTarget = Pick<Window, "addEventListener" | "removeEventListener">;

const movementCodes = ["ArrowLeft", "ArrowRight", "ArrowUp", "Space"];
const jumpCodes = ["ArrowUp", "KeyW"];
const shootCodes = ["Space", "KeyJ"];

export class KeyboardInput implements InputPort {
	private readonly down = new Set<string>();
	private jumpPressed = false;
	private bound = false;

	private readonly onKeyDown = (event: Event): void => {
		const { code, repeat } = event as KeyboardEvent;
		if (movementCodes.includes(code)) event.preventDefault();
		if (!repeat && !this.down.has(code) && jumpCodes.includes(code)) this.jumpPressed = true;
		this.down.add(code);
	};

	private readonly onKeyUp = (event: Event): void => {
		this.down.delete((event as KeyboardEvent).code);
	};

	private readonly onBlur = (): void => {
		this.down.clear();
		this.jumpPressed = false;
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
		return (
			(this.isDown("ArrowRight") || this.isDown("KeyD") ? 1 : 0) -
			(this.isDown("ArrowLeft") || this.isDown("KeyA") ? 1 : 0)
		);
	}

	consumeJumpPressed(): boolean {
		const pressed = this.jumpPressed;
		this.jumpPressed = false;
		return pressed;
	}

	isShootHeld(): boolean {
		return shootCodes.some((code) => this.isDown(code));
	}

	private isDown(code: string): boolean {
		return this.down.has(code);
	}
}

let defaultInput: KeyboardInput | undefined;

function getDefaultInput(): KeyboardInput {
	return (defaultInput ??= new KeyboardInput());
}

// Temporary compatibility wrappers for the pre-port composition root.
export function bindInput(): void {
	getDefaultInput().bind();
}

export const moveAxis = (): number => getDefaultInput().moveAxis();
export const wantsJump = (): boolean => getDefaultInput().consumeJumpPressed();
export const wantsShoot = (): boolean => getDefaultInput().isShootHeld();
