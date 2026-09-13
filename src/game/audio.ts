// Minimal SFX: HTMLAudio one-shots, unlocked on first user gesture.
// Good enough for the demo; replace with a pooled WebAudio mixer later.
let unlocked = false;

export function unlockAudio(): void {
	if (unlocked) return;
	unlocked = true;
	const resume = () => {
		unlocked = true;
	};
	window.addEventListener("pointerdown", resume, { once: true });
	window.addEventListener("keydown", resume, { once: true });
}

export function sfx(url: string, volume = 0.5): void {
	if (!unlocked) return;
	try {
		const el = new Audio(encodeURI(url));
		el.volume = volume;
		void el.play().catch(() => {});
	} catch {
		// Audio must never break the game loop.
	}
}
