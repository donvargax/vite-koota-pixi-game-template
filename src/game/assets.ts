import { Assets, type Texture } from "pixi.js";

const A = "/assets";

const TEX = {
	player_idle: `${A}/platformer-characters/PNG/Player/Poses/player_idle.png`,
	player_walk1: `${A}/platformer-characters/PNG/Player/Poses/player_walk1.png`,
	player_walk2: `${A}/platformer-characters/PNG/Player/Poses/player_walk2.png`,
	player_jump: `${A}/platformer-characters/PNG/Player/Poses/player_jump.png`,
	player_hurt: `${A}/platformer-characters/PNG/Player/Poses/player_hurt.png`,
	zombie_walk1: `${A}/platformer-characters/PNG/Zombie/Poses/zombie_walk1.png`,
	zombie_walk2: `${A}/platformer-characters/PNG/Zombie/Poses/zombie_walk2.png`,
	bolt: `${A}/particle-pack/PNG (Transparent)/spark_04.png`,
	tile_top: `${A}/tiny-dungeon/Tiles/tile_0002.png`,
	tile_fill: `${A}/tiny-dungeon/Tiles/tile_0040.png`,
	sky: `${A}/background-elements/PNG/Flat/sky.png`,
} as const;

export type TexKey = keyof typeof TEX;

export async function loadTextures(): Promise<Record<TexKey, Texture>> {
	const entries = Object.entries(TEX) as [TexKey, string][];
	const out = {} as Record<TexKey, Texture>;
	await Promise.all(
		entries.map(async ([key, url]) => {
			out[key] = await Assets.load(encodeURI(url));
		}),
	);
	return out;
}

export const SFX = {
	shoot: `${A}/digital-audio/Audio/laser1.ogg`,
	hit: `${A}/impact-sounds/Audio/impactGeneric_light_000.ogg`,
	foeDown: `${A}/impact-sounds/Audio/impactPunch_heavy_000.ogg`,
	hurt: `${A}/music-jingles/Audio/Hit jingles/jingles_HIT05.ogg`,
	jump: `${A}/digital-audio/Audio/phaseJump1.ogg`,
	respawn: `${A}/digital-audio/Audio/powerUp1.ogg`,
	coin: `${A}/rpg-audio/Audio/handleCoins.ogg`,
} as const;
