import { component } from "../ecs/facade.ts";

@component()
export class Health {
	value = 100;
	constructor(value = 100) {
		this.value = value;
	}
}

/** Tag: keyboard-controlled. Systems key AI vs player off this. */
@component()
export class PlayerTag {}

/** Tag: slain entities drop nothing yet; marks distractions for bolts. */
@component()
export class FoeTag {}
