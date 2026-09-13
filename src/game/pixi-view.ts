import * as PIXI from "pixi.js";
import type { World } from "../ecs/design2.ts";
import { FLOOR_Y } from "./systems.ts";
import { Position, Sprite, Velocity } from "./components.ts";
import { loadTextures, type TexKey } from "./assets.ts";

const STAGE_W = 480;
const STAGE_H = 320;
const ORIGIN_X = STAGE_W / 2;
const GROUND_SCREEN_Y = 256;
const TILE = 16;

const toScreenX = (x: number): number => ORIGIN_X + x;
const toScreenY = (y: number): number => GROUND_SCREEN_Y - y;

function zombieFrame(tick: number): TexKey {
	return tick % 2 === 0 ? "zombie_walk1" : "zombie_walk2";
}

function playerFrame(vx: number, airborne: boolean, tick: number): TexKey {
	if (airborne) return "player_jump";
	if (Math.abs(vx) > 10) return tick % 2 === 0 ? "player_walk1" : "player_walk2";
	return "player_idle";
}

function pickTexture(kind: string, vx: number, airborne: boolean, tick: number): TexKey {
	if (kind === "zombie") return zombieFrame(tick);
	if (kind === "bolt") return "bolt";
	return playerFrame(vx, airborne, tick);
}

/** View hook: syncs Position+Sprite+Velocity traits to Pixi sprites. */
export class PixiView {
	private app: PIXI.Application | undefined;
	private textures: Record<TexKey, PIXI.Texture> | undefined;
	private nodes = new Map<number, PIXI.Sprite>();

	async mount(parent: HTMLElement, world: World): Promise<void> {
		this.app = new PIXI.Application();
		await this.app.init({ background: 0x0b1020, resizeTo: parent });
		parent.appendChild(this.app.canvas);
		this.textures = await loadTextures();
		this.buildStage();
		this.app.ticker.add((ticker) => this.sync(world, ticker.lastTime));
	}

	private buildStage(): void {
		const app = this.app;
		const tex = this.textures;
		if (!app || !tex) return;
		const sky = new PIXI.Sprite(tex.sky);
		sky.width = STAGE_W;
		sky.height = STAGE_H;
		app.stage.addChild(sky);
		this.buildFloor(app, tex);
	}

	private buildFloor(app: PIXI.Application, tex: Record<TexKey, PIXI.Texture>): void {
		const cols = Math.ceil(STAGE_W / TILE);
		for (let i = 0; i < cols; i++) {
			const top = new PIXI.Sprite(tex.tile_top);
			top.position.set(i * TILE, GROUND_SCREEN_Y);
			app.stage.addChild(top);
			for (let row = GROUND_SCREEN_Y + TILE; row < STAGE_H; row += TILE) {
				const fill = new PIXI.Sprite(tex.tile_fill);
				fill.position.set(i * TILE, row);
				app.stage.addChild(fill);
			}
		}
	}

	private sync(world: World, nowMs: number): void {
		const app = this.app;
		const tex = this.textures;
		if (!app || !tex) return;
		const tick = Math.floor(nowMs / 180);
		const alive = new Set<number>();
		for (const { entity, comps } of world.query<[Position, Sprite, Velocity]>(
			Position,
			Sprite,
			Velocity,
		)) {
			alive.add(entity.id);
			this.syncOne(app, tex, entity.id, comps, tick);
		}
		this.reap(alive);
	}

	private syncOne(
		app: PIXI.Application,
		tex: Record<TexKey, PIXI.Texture>,
		id: number,
		comps: [Position, Sprite, Velocity],
		tick: number,
	): void {
		const [pos, sprite, vel] = comps;
		const node = this.getOrCreateNode(app, tex, id);
		const t = tex[pickTexture(sprite.texture, vel.x, pos.y > FLOOR_Y + 1, tick)];
		if (node.texture !== t) node.texture = t;
		this.applyLook(node, sprite.texture, vel.x);
		node.position.set(toScreenX(pos.x), toScreenY(pos.y));
	}

	private applyLook(node: PIXI.Sprite, kind: string, vx: number): void {
		if (kind === "bolt") {
			node.anchor.set(0.5, 0.5);
			node.blendMode = "add";
			node.scale.set(0.7 * (vx < 0 ? -1 : 1), 0.7);
			return;
		}
		node.anchor.set(0.5, 1);
		node.blendMode = "normal";
		node.scale.set(vx < 0 ? -1 : 1, 1);
	}

	private getOrCreateNode(
		app: PIXI.Application,
		tex: Record<TexKey, PIXI.Texture>,
		id: number,
	): PIXI.Sprite {
		let node = this.nodes.get(id);
		if (node) return node;
		node = new PIXI.Sprite(tex.player_idle);
		node.anchor.set(0.5, 1);
		this.nodes.set(id, node);
		app.stage.addChild(node);
		return node;
	}

	private reap(alive: Set<number>): void {
		for (const [id, node] of this.nodes) {
			if (!alive.has(id)) {
				node.destroy();
				this.nodes.delete(id);
			}
		}
	}
}
