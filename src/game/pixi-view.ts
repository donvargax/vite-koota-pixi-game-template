import * as PIXI from "pixi.js";
import type { World } from "../ecs/design2.ts";
import { Position, Sprite } from "./components.ts";

/** View hook: syncs Position+Sprite traits to PIXI.Graphics circles. */
export class PixiView {
	private app: PIXI.Application | undefined;
	private nodes = new Map<number, PIXI.Graphics>();

	async mount(parent: HTMLElement, world: World): Promise<void> {
		this.app = new PIXI.Application();
		await this.app.init({ background: 0x0b1020, resizeTo: parent });
		parent.appendChild(this.app.canvas);
		this.app.ticker.add(() => this.sync(world));
	}

	private sync(world: World): void {
		if (!this.app) return;
		const alive = new Set<number>();
		for (const { entity, comps } of world.query<[Position, Sprite]>(Position, Sprite)) {
			const [pos, sprite] = comps;
			alive.add(entity.id);
			let g = this.nodes.get(entity.id);
			if (!g) {
				g = new PIXI.Graphics();
				this.nodes.set(entity.id, g);
				this.app.stage.addChild(g);
			}
			g.clear();
			g.circle(0, 0, sprite.size).fill({ color: sprite.color });
			g.position.set(240 + pos.x, 160 - pos.y);
		}
		for (const [id, g] of this.nodes) {
			if (!alive.has(id)) {
				g.destroy();
				this.nodes.delete(id);
			}
		}
	}
}
