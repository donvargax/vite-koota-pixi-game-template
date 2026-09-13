import { describe, expect, it } from "vite-plus/test";
import { HtmlAudio } from "./audio.ts";

describe("HtmlAudio", () => {
	it("stays locked until a pointer or keyboard gesture", async () => {
		const target = new EventTarget();
		const played: Array<{ url: string; volume: number }> = [];
		const audio = new HtmlAudio(target, (url) => {
			const element = {
				volume: 0,
				play: () => Promise.resolve(),
			};
			element.play = () => {
				played.push({ url, volume: element.volume });
				return Promise.resolve();
			};
			return element;
		});
		audio.bind();

		audio.play("sounds/locked.ogg");
		expect(played).toEqual([]);

		target.dispatchEvent(new Event("pointerdown"));
		audio.play("sounds/coin sound.ogg", 0.25);
		await Promise.resolve();
		expect(played).toEqual([{ url: "sounds/coin%20sound.ogg", volume: 0.25 }]);
		audio.dispose();
	});

	it("sets volume and swallows playback failures", () => {
		const target = new EventTarget();
		let volume = 0;
		const audio = new HtmlAudio(target, () => ({
			get volume() {
				return volume;
			},
			set volume(value: number) {
				volume = value;
			},
			play: () => Promise.reject(new Error("autoplay blocked")),
		}));
		audio.bind();
		target.dispatchEvent(new Event("keydown"));

		expect(() => audio.play("sounds/hit.ogg", 0.4)).not.toThrow();
		expect(volume).toBe(0.4);
		audio.dispose();
	});

	it("removes unlock listeners during disposal", () => {
		const target = new EventTarget();
		let created = 0;
		const audio = new HtmlAudio(target, () => {
			created += 1;
			return { volume: 0, play: () => Promise.resolve() };
		});
		audio.bind();
		audio.dispose();
		target.dispatchEvent(new Event("pointerdown"));
		audio.play("sounds/after-dispose.ogg");

		expect(created).toBe(0);
	});
});
