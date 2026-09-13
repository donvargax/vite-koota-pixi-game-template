import type { AudioPort } from "./contracts.ts";

type AudioTarget = Pick<Window, "addEventListener" | "removeEventListener">;
type AudioElement = Pick<HTMLAudioElement, "play" | "volume">;
type AudioFactory = (url: string) => AudioElement;

export class HtmlAudio implements AudioPort {
	private unlocked = false;
	private bound = false;

	private readonly onGesture = (): void => {
		this.unlocked = true;
		this.removeUnlockListeners();
	};

	constructor(
		private readonly target: AudioTarget = window,
		private readonly createAudio: AudioFactory = (url) => new Audio(url),
	) {}

	bind(): void {
		if (this.bound) return;
		this.target.addEventListener("pointerdown", this.onGesture);
		this.target.addEventListener("keydown", this.onGesture);
		this.bound = true;
	}

	dispose(): void {
		this.removeUnlockListeners();
		this.unlocked = false;
	}

	play(sound: string, volume = 0.5): void {
		if (!this.unlocked) return;
		try {
			const element = this.createAudio(encodeURI(sound));
			element.volume = volume;
			void Promise.resolve(element.play()).catch(() => {});
		} catch {
			// Audio must never break the game loop.
		}
	}

	private removeUnlockListeners(): void {
		if (!this.bound) return;
		this.target.removeEventListener("pointerdown", this.onGesture);
		this.target.removeEventListener("keydown", this.onGesture);
		this.bound = false;
	}
}

let defaultAudio: HtmlAudio | undefined;

function getDefaultAudio(): HtmlAudio {
	return (defaultAudio ??= new HtmlAudio());
}

// Temporary compatibility wrappers for the pre-port composition root.
export function unlockAudio(): void {
	getDefaultAudio().bind();
}

export function sfx(url: string, volume = 0.5): void {
	getDefaultAudio().play(url, volume);
}
