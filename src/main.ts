import "./style.css";
import { World, registerSingleton, resolve, IWorld, type EntityRef } from "./ecs/design2.ts";
import { FoeTag, Gun, Health, PlayerTag, Position, Sprite, Velocity } from "./game/components.ts";
import "./game/systems.ts";
import { bindInput } from "./game/input.ts";
import { sfx, unlockAudio } from "./game/audio.ts";
import { SFX } from "./game/assets.ts";
import { PixiView } from "./game/pixi-view.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main style="font-family: system-ui; color: #e6edf3; background: #0b1020; min-height: 100vh; padding: 24px">
    <h1>Terrariavania — sprite demo</h1>
    <p>Move <code>A</code>/<code>D</code> or <code>←</code>/<code>→</code>, jump <code>W</code>/<code>↑</code>, shoot <code>Space</code>. CC0 art/audio by Kenney (see <code>docs/assets.md</code>).</p>
    <div style="display:flex; gap:24px; align-items:flex-start">
      <div id="stage" style="width:480px; height:320px; border:1px solid #30363d"></div>
      <div>
        <div>hp: <strong id="hp">100</strong></div>
        <div>foes: <strong id="count">0</strong></div>
        <div>player x: <strong id="px">0</strong></div>
        <button id="hurt" type="button">Damage player (25)</button>
        <button id="spawn" type="button">Spawn slime</button>
      </div>
    </div>
  </main>
`;

bindInput();
unlockAudio();

registerSingleton(IWorld, new World());
const world = resolve<World>(IWorld);

// Exposed for e2e/debugging (inspect entity counts from the console).
(window as unknown as { __game: { world: World } }).__game = { world };

function spawnPlayer(): EntityRef {
	return world.spawn(
		new Position(0, 40),
		new Velocity(0, 0),
		new Health(100),
		new Sprite("player"),
		new PlayerTag(),
		new Gun(),
	);
}

function spawnZombie(x: number): void {
	world.spawn(
		new Position(x, 0),
		new Velocity(0, 0),
		new Health(3),
		new Sprite("zombie"),
		new FoeTag(),
	);
}

let player = spawnPlayer();
spawnZombie(-140);
spawnZombie(120);
spawnZombie(190);

const stage = document.querySelector<HTMLElement>("#stage")!;
const view = new PixiView();
await view.mount(stage, world);

const hpEl = document.querySelector("#hp")!;
const countEl = document.querySelector("#count")!;
const pxEl = document.querySelector("#px")!;
document.querySelector("#hurt")!.addEventListener("click", () => {
	if (player.raw.isAlive()) {
		player.set(Health, { value: player.get(Health).value - 25 });
		sfx(SFX.hurt, 0.5);
	}
});
document.querySelector("#spawn")!.addEventListener("click", () => {
	spawnZombie(-160 + Math.random() * 320);
});

let prevHp = 100;
let prevFoes = 3;
let deadTimer = 0;
let emptyTimer = 0;

let last = performance.now();
function frame(now: number): void {
	const dt = Math.min((now - last) / 1000, 1 / 30);
	last = now;
	world.update(dt);

	const alive = player.raw.isAlive();
	const hp = alive ? player.get(Health).value : 0;
	const foes = world.query(Position, FoeTag).count;

	playHitSounds(hp, foes, alive);
	maybeRespawnPlayer(alive, dt);
	maybeReinforce(foes, dt);
	updateHud(alive, hp, foes);
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function playHitSounds(hp: number, foes: number, alive: boolean): void {
	if (hp < prevHp && alive) sfx(SFX.hurt, 0.4);
	if (foes < prevFoes) sfx(SFX.foeDown, 0.5);
	prevHp = hp;
	prevFoes = foes;
}

function maybeRespawnPlayer(alive: boolean, dt: number): void {
	if (alive) return;
	deadTimer += dt;
	if (deadTimer <= 2) return;
	deadTimer = 0;
	player = spawnPlayer();
	prevHp = 100;
	sfx(SFX.respawn, 0.5);
}

function maybeReinforce(foes: number, dt: number): void {
	if (foes > 0) {
		emptyTimer = 0;
		return;
	}
	emptyTimer += dt;
	if (emptyTimer <= 3) return;
	emptyTimer = 0;
	spawnZombie(-160);
	spawnZombie(160);
	prevFoes = 2;
	sfx(SFX.coin, 0.5);
}

function updateHud(alive: boolean, hp: number, foes: number): void {
	hpEl.textContent = alive ? String(hp) : "dead";
	countEl.textContent = String(foes);
	pxEl.textContent = alive ? player.get(Position).x.toFixed(1) : "—";
}
