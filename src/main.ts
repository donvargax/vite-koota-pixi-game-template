import "./style.css";
import { World, registerSingleton, resolve, IWorld, type EntityRef } from "./ecs/design2.ts";
import { Health, Position, Sprite, Velocity } from "./game/components.ts";
import "./game/systems.ts";
import { PixiView } from "./game/pixi-view.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main style="font-family: system-ui; color: #e6edf3; background: #0b1020; min-height: 100vh; padding: 24px">
    <h1>Terrariavania — Design 2 playground</h1>
    <p>Aurelia-style ECS (decorators + <code>resolve()</code>) over koota. Edit <code>src/game/systems.ts</code> to test HMR.</p>
    <div style="display:flex; gap:24px; align-items:flex-start">
      <div id="stage" style="width:480px; height:320px; border:1px solid #30363d"></div>
      <div>
        <div>entities: <strong id="count">0</strong></div>
        <div>player x: <strong id="px">0</strong></div>
        <button id="hurt" type="button">Damage player (25)</button>
        <button id="spawn" type="button">Spawn slime</button>
      </div>
    </div>
  </main>
`;

registerSingleton(IWorld, new World());
const world = resolve<World>(IWorld);

const player: EntityRef = world.spawn(
	new Position(0, 0),
	new Velocity(24, 8),
	new Health(100),
	new Sprite(0x7ee787, 12),
);
world.spawn(new Position(-60, 20), new Velocity(10, 0), new Health(30), new Sprite(0xffa657, 10));

const stage = document.querySelector<HTMLElement>("#stage")!;
const view = new PixiView();
await view.mount(stage, world);

const countEl = document.querySelector("#count")!;
const pxEl = document.querySelector("#px")!;
document.querySelector("#hurt")!.addEventListener("click", () => {
	player.set(Health, { value: player.get(Health).value - 25 });
});
document.querySelector("#spawn")!.addEventListener("click", () => {
	world.spawn(
		new Position(-80 + Math.random() * 160, 40),
		new Velocity(12, 0),
		new Health(30),
		new Sprite(0xffa657, 10),
	);
});

let last = performance.now();
function frame(now: number): void {
	const dt = Math.min((now - last) / 1000, 1 / 30);
	last = now;
	// Simple bounce to keep the demo on stage.
	// NOTE: get() returns a snapshot, so writes must go through set().
	const p = player.get(Position);
	const v = player.get(Velocity);
	if (p.x > 200 || p.x < -200) player.set(Velocity, { x: v.x * -1 });
	if (p.y > 120 || p.y < -120) player.set(Velocity, { y: v.y * -1 });
	world.update(dt);
	countEl.textContent = String(world.query(Position).count);
	try {
		pxEl.textContent = player.get(Position).x.toFixed(1);
	} catch {
		pxEl.textContent = "dead";
	}
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
