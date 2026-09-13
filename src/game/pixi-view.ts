import * as PIXI from "pixi.js";
import { loadTextures, type TexKey } from "./assets.ts";
import type {
	RenderAnimation,
	RenderEntityProjection,
	RenderProjection,
} from "./game-view-model.ts";

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

function pickTexture(kind: string, animation: RenderAnimation, tick: number): TexKey {
	if (kind === "zombie") return zombieFrame(tick);
	if (kind === "bolt") return "bolt";
	return playerTexture(animation, tick);
}

function playerTexture(animation: RenderAnimation, tick: number): TexKey {
	if (animation === "jump") return "player_jump";
	return playerFrame(animation === "walk" ? 1 : 0, false, tick);
}

export class PixiView {
	private app: PIXI.Application | undefined;
	private textures: Record<TexKey, PIXI.Texture> | undefined;
	private nodes = new Map<number, PIXI.Sprite>();

	async mount(parent: HTMLElement): Promise<void> {
		this.app = new PIXI.Application();
		await this.app.init({ background: 0x0b1020, resizeTo: parent, autoStart: false });
		parent.appendChild(this.app.canvas);
		this.textures = await loadTextures();
		this.buildStage();
	}

	render(projection: RenderProjection, nowMs: number): void {
		const app = this.app;
		const tex = this.textures;
		if (!app || !tex) return;
		const tick = Math.floor(nowMs / 180);
		const alive = new Set<number>();
		for (const entity of projection.entities) {
			alive.add(entity.id);
			this.renderOne(app, tex, entity, tick);
		}
		this.reap(alive);
		app.render();
	}

	dispose(): void {
		const app = this.app;
		this.app = undefined;
		this.textures = undefined;
		this.nodes.clear();
		if (!app) return;
		app.ticker.stop();
		app.destroy({ removeView: true }, { children: true });
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

	private renderOne(
		app: PIXI.Application,
		tex: Record<TexKey, PIXI.Texture>,
		entity: RenderEntityProjection,
		tick: number,
	): void {
		const node = this.getOrCreateNode(app, tex, entity.id);
		const t = tex[pickTexture(entity.kind, entity.animation, tick)];
		if (node.texture !== t) node.texture = t;
		this.applyLook(node, entity.kind, entity.facing);
		node.position.set(toScreenX(entity.x), toScreenY(entity.y));
	}

	private applyLook(node: PIXI.Sprite, kind: string, facing: number): void {
		if (kind === "bolt") {
			node.anchor.set(0.5, 0.5);
			node.blendMode = "add";
			node.scale.set(0.7 * (facing < 0 ? -1 : 1), 0.7);
			return;
		}
		node.anchor.set(0.5, 1);
		node.blendMode = "normal";
		node.scale.set(facing < 0 ? -1 : 1, 1);
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
