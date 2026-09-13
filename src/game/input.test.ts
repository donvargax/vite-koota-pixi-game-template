import { describe, expect, it } from "vite-plus/test";
import { KeyboardInput } from "./input.ts";

function keyEvent(type: "keydown" | "keyup", code: string, repeat = false): Event {
	const event = new Event(type, { cancelable: true });
	Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
	return event;
}

describe("KeyboardInput", () => {
	it("tracks held movement and shooting state", () => {
		const target = new EventTarget();
		const input = new KeyboardInput(target);
		input.bind();

		target.dispatchEvent(keyEvent("keydown", "KeyD"));
		target.dispatchEvent(keyEvent("keydown", "Space"));

		expect(input.moveAxis()).toBe(1);
		expect(input.isShootHeld()).toBe(true);
		target.dispatchEvent(keyEvent("keyup", "KeyD"));
		target.dispatchEvent(keyEvent("keyup", "Space"));
		expect(input.moveAxis()).toBe(0);
		expect(input.isShootHeld()).toBe(false);
		input.dispose();
	});

	it("consumes one jump edge and ignores repeated keydown events", () => {
		const target = new EventTarget();
		const input = new KeyboardInput(target);
		input.bind();

		target.dispatchEvent(keyEvent("keydown", "ArrowUp"));
		target.dispatchEvent(keyEvent("keydown", "ArrowUp", true));
		expect(input.consumeJumpPressed()).toBe(true);
		expect(input.consumeJumpPressed()).toBe(false);
		target.dispatchEvent(keyEvent("keyup", "ArrowUp"));
		target.dispatchEvent(keyEvent("keydown", "ArrowUp"));
		expect(input.consumeJumpPressed()).toBe(true);
		input.dispose();
	});

	it("binds idempotently, clears on blur, and removes listeners on disposal", () => {
		const target = new EventTarget();
		const input = new KeyboardInput(target);
		input.bind();
		input.bind();
		target.dispatchEvent(keyEvent("keydown", "KeyA"));
		target.dispatchEvent(keyEvent("keydown", "KeyW"));
		target.dispatchEvent(new Event("blur"));
		expect(input.moveAxis()).toBe(0);
		expect(input.consumeJumpPressed()).toBe(false);

		input.dispose();
		target.dispatchEvent(keyEvent("keydown", "KeyD"));
		expect(input.moveAxis()).toBe(0);
	});
});
