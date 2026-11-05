import { keystore } from '$core/keystore/keystore-client';

const THROTTLE_MS = 30_000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function trackActivity(target: Window = window): () => void {
	let last = 0;
	const touch = () => {
		const now = Date.now();
		if (now - last < THROTTLE_MS) return;
		last = now;
		void keystore.touch().catch(() => undefined);
	};
	for (const name of EVENTS) target.addEventListener(name, touch, { passive: true, capture: true });
	return () => {
		for (const name of EVENTS) target.removeEventListener(name, touch, { capture: true });
	};
}
