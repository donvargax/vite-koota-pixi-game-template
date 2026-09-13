import { expect, test } from "@playwright/test";

test("design 2 playground boots and simulates", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (err) => errors.push(err.message));
	await page.goto("/");
	await expect(page.getByText("Terrariavania — sprite demo")).toBeVisible();
	await expect(page.locator("#stage canvas")).toBeVisible();
	// Textures load async; the HUD updates on the first simulated frame.
	await expect
		.poll(async () => Number(await page.locator("#count").textContent()), { timeout: 15000 })
		.toBeGreaterThan(0);
	await page.getByRole("button", { name: "Spawn slime" }).click();
	expect(errors, `page errors: ${errors.join("; ")}`).toEqual([]);
});
