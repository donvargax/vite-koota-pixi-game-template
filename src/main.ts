import "./style.css";
import { HtmlAudio } from "./game/audio.ts";
import type { RandomPort } from "./game/contracts.ts";
import { GameViewModel } from "./game/game-view-model.ts";
import { KeyboardInput } from "./game/input.ts";
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

const stage = document.querySelector<HTMLElement>("#stage")!;
const input = new KeyboardInput();
const audio = new HtmlAudio();
const random: RandomPort = { next: () => Math.random() };
input.bind();
audio.bind();

const model = new GameViewModel({ input, audio, random });
model.start();
const view = new PixiView();
const hpEl = document.querySelector("#hp")!;
const countEl = document.querySelector("#count")!;
const pxEl = document.querySelector("#px")!;

await view.mount(stage);

document.querySelector("#hurt")!.addEventListener("click", () => model.damagePlayer(25));
document.querySelector("#spawn")!.addEventListener("click", () => model.spawnFoe());

let disposed = false;
let frameHandle: number | undefined;
let last = performance.now();

function dispose(): void {
	if (disposed) return;
	disposed = true;
	if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
	input.dispose();
	audio.dispose();
	view.dispose();
	model.dispose();
}

window.addEventListener("pagehide", dispose, { once: true });

function frame(now: number): void {
	if (disposed) return;
	const dt = Math.min((now - last) / 1000, 1 / 30);
	last = now;
	model.tick(dt);
	const hud = model.getHudProjection();
	updateHud(hud.playerHealth, hud.foeCount, hud.playerX);
	view.render(model.getRenderProjection(), now);
	frameHandle = requestAnimationFrame(frame);
}

frameHandle = requestAnimationFrame(frame);

function updateHud(playerHealth: number | "dead", foeCount: number, playerX: number | null): void {
	hpEl.textContent = String(playerHealth);
	countEl.textContent = String(foeCount);
	pxEl.textContent = playerX === null ? "—" : playerX.toFixed(1);
}
