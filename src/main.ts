import "./style.css";
import { HtmlAudio } from "./game/audio.ts";
import { createBrowserRuntime, type BrowserRuntimeController } from "./game/browser-runtime.ts";
import type { RandomPort } from "./game/contracts.ts";
import { KeyboardInput } from "./game/input.ts";

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
const hurtButton = document.querySelector<HTMLButtonElement>("#hurt")!;
const spawnButton = document.querySelector<HTMLButtonElement>("#spawn")!;

let disposed = false;
let buttonsBound = false;
let runtime: BrowserRuntimeController | undefined;

const animationFrame = {
	now: () => performance.now(),
	request: (callback: (nowMs: number) => void) => requestAnimationFrame(callback),
	cancel: (handle: number) => cancelAnimationFrame(handle),
};

const onHurt = (): void => {
	if (!disposed) void runtime?.damagePlayer(25);
};
const onSpawn = (): void => {
	if (!disposed) void runtime?.spawnFoe();
};
const onPageHide = (): void => {
	try {
		dispose();
	} catch (error) {
		console.error(error);
	}
};

function dispose(): void {
	if (disposed) return;
	disposed = true;
	removePageListeners();
	const errors = disposeOwnedResources();
	if (errors.length > 0) throw new AggregateError(errors, "Page cleanup failed");
}

function removePageListeners(): void {
	window.removeEventListener("pagehide", onPageHide);
	if (buttonsBound) {
		hurtButton.removeEventListener("click", onHurt);
		spawnButton.removeEventListener("click", onSpawn);
		buttonsBound = false;
	}
}

function disposeOwnedResources(): Error[] {
	const errors: Error[] = [];
	for (const cleanup of [() => runtime?.dispose(), () => audio.dispose(), () => input.dispose()]) {
		try {
			cleanup();
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
	}
	return errors;
}

window.addEventListener("pagehide", onPageHide, { once: true });

try {
	input.bind();
	audio.bind();
	runtime = createBrowserRuntime({
		parent: stage,
		ports: { input, audio, random },
		animationFrame,
		updateHud,
	});
	await runtime.ready;
	if (!disposed) {
		hurtButton.addEventListener("click", onHurt);
		spawnButton.addEventListener("click", onSpawn);
		buttonsBound = true;
	}
} catch (error) {
	const wasDisposed = disposed;
	try {
		dispose();
	} catch (cleanupError) {
		if (!wasDisposed) throw new AggregateError([error, cleanupError], "Startup and cleanup failed");
	}
	if (!wasDisposed) throw error;
}

function updateHud(projection: {
	readonly playerHealth: number | "dead";
	readonly foeCount: number;
	readonly playerX: number | null;
}): void {
	hpEl.textContent = String(projection.playerHealth);
	countEl.textContent = String(projection.foeCount);
	pxEl.textContent = projection.playerX === null ? "—" : projection.playerX.toFixed(1);
}
