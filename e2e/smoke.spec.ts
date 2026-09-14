import { expect, test } from "@playwright/test";

test("ECS playground boots and simulates", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (err) => errors.push(err.message));
	await page.goto("/");
	await expect(page.getByText("Terrariavania — sprite demo")).toBeVisible();
	await expect(page.locator("#stage canvas")).toBeVisible();
	// Textures load async; the HUD updates on the first simulated frame.
	await expect
		.poll(async () => Number(await page.locator("#count").textContent()), { timeout: 15000 })
		.toBeGreaterThan(0);
	const initialFoeCount = Number(await page.locator("#count").textContent());
	await page.getByRole("button", { name: "Spawn slime" }).click();
	await expect
		.poll(async () => Number(await page.locator("#count").textContent()))
		.toBe(initialFoeCount + 1);
	await page.getByRole("button", { name: "Damage player (25)" }).click();
	await expect.poll(async () => Number(await page.locator("#hp").textContent())).toBe(75);
	await expect(page.locator("#stage canvas")).toBeVisible();
	expect(errors, `page errors: ${errors.join("; ")}`).toEqual([]);
});
