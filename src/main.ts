import "./style.css";
import { World } from "./ecs/design2.ts";
import { HtmlAudio } from "./game/audio.ts";
import type { RandomPort } from "./game/contracts.ts";
import { GameViewModel } from "./game/game-view-model.ts";
import { KeyboardInput } from "./game/input.ts";
import { PixiView } from "./game/pixi-view.ts";
import { createGameSystems } from "./game/systems.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main style="font-family: system-ui; color: #e6edf3; background: #0b1020; min-height: 100vh; padding: 24px">
    <h1>Terrariavania — sprite demo</h1>
    <p>Move <code>←</code>/<code>→</code>, jump <code>↑</code>, aim <code>W</code>/<code>A</code>/<code>S</code>/<code>D</code>, dash <code>Shift</code>, shoot both guns with <code>Space</code>. CC0 art/audio by Kenney (see <code>docs/assets.md</code>).</p>
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

const stage = document.querySelector<HTMLElement>("#stage")!;
const input = new KeyboardInput();
const audio = new HtmlAudio();
const random: RandomPort = { next: () => Math.random() };
const hpEl = document.querySelector("#hp")!;
const countEl = document.querySelector("#count")!;
const pxEl = document.querySelector("#px")!;

let disposed = false;
let frameHandle: number | undefined;
let world: World | undefined;
let model: GameViewModel | undefined;
let view: PixiView | undefined;
let last = performance.now();

function dispose(): void {
	if (disposed) return;
	disposed = true;
	if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
	frameHandle = undefined;
	window.removeEventListener("pagehide", dispose);
	view?.dispose();
	model?.dispose();
	world?.dispose();
	audio.dispose();
	input.dispose();
}

window.addEventListener("pagehide", dispose, { once: true });

try {
	input.bind();
	audio.bind();
	world = World.create((created) => createGameSystems(created, input, audio));
	model = new GameViewModel({ world, audio, random });
	model.start();
	view = new PixiView();
	await view.mount(stage);

	document.querySelector("#hurt")!.addEventListener("click", () => model?.damagePlayer(25));
	document.querySelector("#spawn")!.addEventListener("click", () => model?.spawnFoe());

	frameHandle = requestAnimationFrame(frame);
} catch (error) {
	dispose();
	throw error;
}

function frame(now: number): void {
	if (disposed) return;
	const dt = Math.min((now - last) / 1000, 1 / 30);
	last = now;
	const currentModel = model;
	const currentView = view;
	if (!currentModel || !currentView) return;
	currentModel.tick(dt);
	const hud = currentModel.getHudProjection();
	updateHud(hud.playerHealth, hud.foeCount, hud.playerX);
	currentView.render(currentModel.getRenderProjection(), now);
	frameHandle = requestAnimationFrame(frame);
}

function updateHud(playerHealth: number | "dead", foeCount: number, playerX: number | null): void {
	hpEl.textContent = String(playerHealth);
	countEl.textContent = String(foeCount);
	pxEl.textContent = playerX === null ? "—" : playerX.toFixed(1);
}
