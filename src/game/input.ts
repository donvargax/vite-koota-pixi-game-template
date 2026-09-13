const down = new Set<string>();

function isDown(code: string): boolean {
	return down.has(code);
}

export function bindInput(): void {
	window.addEventListener("keydown", (e) => {
		if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(e.code)) e.preventDefault();
		down.add(e.code);
	});
	window.addEventListener("keyup", (e) => {
		down.delete(e.code);
	});
	window.addEventListener("blur", () => down.clear());
}

export const moveAxis = (): number =>
	(isDown("ArrowRight") || isDown("KeyD") ? 1 : 0) -
	(isDown("ArrowLeft") || isDown("KeyA") ? 1 : 0);
export const wantsJump = (): boolean => isDown("ArrowUp") || isDown("KeyW");
export const wantsShoot = (): boolean => isDown("Space") || isDown("KeyJ");
