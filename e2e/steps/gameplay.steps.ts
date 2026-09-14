import { expect } from "@playwright/test";
import { Given, When, Then } from "../support/fixtures.ts";
import type { Direction } from "../support/game-page.ts";

Given("I have entered a fresh arena", async ({ game }) => {
	await game.enterArena();
});

When(/^I walk (left|right)$/, async ({ game }, direction: Direction) => {
	await game.walk(direction);
});

When("I release the movement controls", async ({ game }) => {
	await game.releaseControls();
});

Then(/^I move (left|right) from the starting point$/, async ({ game }, direction: Direction) => {
	const displacement =
		((await game.position()) - game.startingPosition) * (direction === "left" ? -1 : 1);
	expect(displacement, `The player should move ${direction}`).toBeGreaterThan(5);
});

When(/^I compare a (left|right) dash with walking$/, async ({ game }, direction: Direction) => {
	await game.compareDashWithWalking(direction);
});

Then(
	/^the dash carries me farther (left|right) than walking for the same time$/,
	async ({ game }, direction: Direction) => {
		expect(game.walkingDistance, "Ordinary walking should move the player").toBeGreaterThan(5);
		const distance = game.dashDisplacement * (direction === "left" ? -1 : 1);
		expect(
			distance,
			"Dashing without movement held should outpace ordinary walking",
		).toBeGreaterThan(game.walkingDistance * 1.5);
	},
);

When("I fire right at the approaching enemies", async ({ game }) => {
	await game.fireRight();
});

Then("fewer enemies remain in the arena", async ({ game }) => {
	expect(game.initialFoeCount, "The arena should have enemies before shooting").toBeGreaterThan(0);
	const remaining = await game.page.locator("#count").innerText();
	expect(remaining).toMatch(/^\d+$/);
	expect(Number(remaining), "Shooting should defeat an enemy").toBeLessThan(game.initialFoeCount);
});

Given("I am standing on the arena floor", async ({ game }) => {
	await game.elapse(480);
	await game.expectPlayerView("grounded");
});

When("I jump", async ({ game }) => {
	await game.jump();
});

Then("I am visibly above the floor", async ({ game }) => {
	await game.expectPlayerView("airborne");
});

Then("I land back on the floor", async ({ game }) => {
	await game.elapse(640);
	await game.expectPlayerView("grounded");
});

Then("I remain where I stopped", async ({ game }) => {
	await game.elapse(80);
	const stopped = await game.position();
	for (let sample = 0; sample < 4; sample++) {
		await game.elapse(80);
		expect(
			Math.abs((await game.position()) - stopped),
			"The player should stay still",
		).toBeLessThan(0.2);
	}
});
