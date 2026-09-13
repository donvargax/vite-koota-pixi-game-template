import { component } from "../ecs/design2.ts";

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
export class Health {
	value = 100;
	constructor(value = 100) {
		this.value = value;
	}
}

@component()
export class Sprite {
	color = 0xffffff;
	size = 12;
	constructor(color = 0xffffff, size = 12) {
		this.color = color;
		this.size = size;
	}
}
