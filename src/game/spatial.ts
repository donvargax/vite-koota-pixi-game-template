import { component } from "../ecs/facade.ts";

export const FLOOR_Y = 0;

@component()
export class Position {
	x = 0;
	y = 0;
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
}

@component()
export class Velocity {
	x = 0;
	y = 0;
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
}

@component()
export class Facing {
	x = 1;
	y = 0;

	constructor(x = 1, y = 0) {
		this.x = x;
		this.y = y;
	}
}
