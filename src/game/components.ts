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

/** Visual kind id resolved by the Pixi view ('player' | 'zombie' | 'bolt'). */
@component()
export class Sprite {
	texture = "player";
	constructor(texture = "player") {
		this.texture = texture;
	}
}

/** Tag: keyboard-controlled. Systems key AI vs player off this. */
@component()
export class PlayerTag {}

/** Tag: slain entities drop nothing yet; marks distractions for bolts. */
@component()
export class FoeTag {}

@component()
export class Gun {
	cooldown = 0;
	constructor(cooldown = 0) {
		this.cooldown = cooldown;
	}
}

@component()
export class AimGun {
	cooldown = 0;
	constructor(cooldown = 0) {
		this.cooldown = cooldown;
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

@component()
export class Aim {
	x = 1;
	y = 0;

	constructor(x = 1, y = 0) {
		this.x = x;
		this.y = y;
	}
}

@component()
export class Projectile {
	damage = 1;
	life = 1;
	constructor(damage = 1, life = 1) {
		this.damage = damage;
		this.life = life;
	}
}

@component()
export class DashState {
	remaining = 0;
	cooldown = 0;

	constructor(remaining = 0, cooldown = 0) {
		this.remaining = remaining;
		this.cooldown = cooldown;
	}
}
