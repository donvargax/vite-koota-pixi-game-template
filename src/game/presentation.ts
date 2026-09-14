import { component } from "../ecs/facade.ts";

/** Visual kind id resolved by the Pixi view ('player' | 'zombie' | 'bolt'). */
@component()
export class Sprite {
	texture = "player";
	constructor(texture = "player") {
		this.texture = texture;
	}
}
