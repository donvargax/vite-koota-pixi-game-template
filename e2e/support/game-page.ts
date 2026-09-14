import { setTimeout } from "node:timers/promises";
import { expect, type Page } from "@playwright/test";

export type Direction = "left" | "right";

export class GamePage {
	private readonly heldKeys = new Set<string>();
	startingPosition = 0;
	walkingDistance = 0;
	dashDisplacement = 0;
	initialFoeCount = 0;

	constructor(
		readonly page: Page,
		private readonly controlledTime: boolean,
	) {}

	async enterArena(): Promise<void> {
		if (this.controlledTime) {
			const start = new Date("2026-01-01T00:00:00Z");
			await this.page.clock.install({ time: start });
			// Fix wall time before pausing so setup cannot race into the past.
			await this.page.clock.setFixedTime(start);
			await this.page.clock.pauseAt(start);
		}
		await this.page.goto("/", { waitUntil: "commit" });
		// Canvas attachment precedes texture loading. Pump time while assets load.
		await expect
			.poll(
				async () => {
					await this.elapse(16);
					return this.page.locator("#count").textContent();
				},
				{ timeout: 15_000, intervals: [50], message: "The arena should finish loading" },
			)
			.toBe("3");
		await expect(this.page.locator("#stage canvas")).toBeVisible();
		await expect(this.page.locator("#hp")).toHaveText("100");
		this.startingPosition = await this.position();
	}

	async position(): Promise<number> {
		const text = await this.page.locator("#px").innerText();
		expect(text, "The visible player position should be numeric").toMatch(/^-?\d+(\.\d+)?$/);
		return Number(text);
	}

	async walk(direction: Direction, duration = 240): Promise<void> {
		await this.hold(direction === "left" ? "ArrowLeft" : "ArrowRight");
		await this.elapse(duration);
	}

	async compareDashWithWalking(direction: Direction): Promise<void> {
		const before = await this.position();
		await this.walk(direction);
		await this.releaseControls();
		this.walkingDistance = Math.abs((await this.position()) - before);
		await this.elapse(80);
		const dashStart = await this.position();
		await this.hold("Shift");
		await this.elapse(240);
		await this.releaseControls();
		this.dashDisplacement = (await this.position()) - dashStart;
	}

	async fireRight(): Promise<void> {
		this.initialFoeCount = Number(await this.page.locator("#count").innerText());
		await this.hold("d");
		await this.hold("Space");
		try {
			// A bounded burst, not an unbounded retry until combat succeeds.
			await this.elapse(1600);
		} finally {
			await this.releaseControls();
		}
	}

	async jump(): Promise<void> {
		await this.hold("ArrowUp");
		await this.elapse(240);
		await this.releaseControls();
	}

	async expectPlayerView(name: "grounded" | "airborne"): Promise<void> {
		const canvas = await this.page.locator("#stage canvas").boundingBox();
		if (!canvas) throw new Error("The arena canvas is not visible");
		// A screen-space crop around the starting area excludes approaching enemies.
		// It includes the player, sky, and floor; no sprite/state inspection is used.
		await expect(this.page).toHaveScreenshot(`player-${name}.png`, {
			clip: { x: canvas.x + canvas.width / 2 - 32, y: canvas.y + 100, width: 64, height: 180 },
			scale: "css",
			maxDiffPixels: 0,
		});
	}

	async releaseControls(): Promise<void> {
		for (const key of this.heldKeys) {
			await this.page.keyboard.up(key);
			this.heldKeys.delete(key);
		}
	}

	async elapse(milliseconds: number): Promise<void> {
		if (this.controlledTime) await this.page.clock.runFor(milliseconds);
		else await setTimeout(milliseconds);
	}

	private async hold(key: string): Promise<void> {
		this.heldKeys.add(key);
		await this.page.keyboard.down(key);
	}
}
