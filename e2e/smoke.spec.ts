import { expect, test } from "@playwright/test";

test("design 2 playground boots and simulates", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByText("Terrariavania — Design 2 playground")).toBeVisible();
	await expect(page.locator("#stage canvas")).toBeVisible();
	const count = await page.locator("#count").textContent();
	expect(Number(count)).toBeGreaterThan(0);
	await page.getByRole("button", { name: "Spawn slime" }).click();
});
