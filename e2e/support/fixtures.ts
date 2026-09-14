import { expect } from "@playwright/test";
import { createBdd, test as base } from "playwright-bdd";
import { GamePage } from "./game-page.ts";

export const test = base.extend<{ game: GamePage }>({
	game: async ({ page }, use, testInfo) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const game = new GamePage(page, testInfo.project.name !== "realtime");
		try {
			await use(game);
		} finally {
			try {
				await game.releaseControls();
			} catch (error) {
				errors.push(`Control cleanup failed: ${String(error)}`);
			}
			if (testInfo.status !== testInfo.expectedStatus || errors.length > 0) {
				const visibleText = await page
					.locator("body")
					.innerText({ timeout: 1000 })
					.catch(() => "Page unavailable");
				await testInfo.attach("browser-observations", {
					body: JSON.stringify({ errors, visibleText }),
					contentType: "application/json",
				});
			}
			expect(errors, "The game should not raise browser errors").toEqual([]);
		}
	},
});

export const { Given, When, Then } = createBdd(test);
