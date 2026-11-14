import type { Conditions } from './scheduler';

const QUIET_MS = 2000;
const LOW_BATTERY = 0.2;
const INPUT_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart', 'scroll'] as const;

interface Battery extends EventTarget {
	charging: boolean;
	level: number;
}

interface Connection extends EventTarget {
	saveData?: boolean;
}

export function watchActivity(report: (conditions: Conditions) => void): () => void {
	const nav = navigator as Navigator & { connection?: Connection; getBattery?: () => Promise<Battery> };
	let idle = true;
	let battery: Battery | null = null;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let last = '';

	const emit = () => {
		if (stopped) return;
		const conditions: Conditions = {
			visible: document.visibilityState === 'visible',
			idle,
			constrained: nav.connection?.saveData === true || (!!battery && !battery.charging && battery.level <= LOW_BATTERY)
		};
		const key = `${conditions.visible}${conditions.idle}${conditions.constrained}`;
		if (key === last) return;
		last = key;
		report(conditions);
	};

	const busy = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			idle = true;
			emit();
		}, QUIET_MS);
		if (!idle) return;
		idle = false;
		emit();
	};

	const options = { capture: true, passive: true } as const;
	for (const type of INPUT_EVENTS) window.addEventListener(type, busy, options);
	document.addEventListener('visibilitychange', emit);
	nav.connection?.addEventListener('change', emit);
	void nav
		.getBattery?.()
		.then((b) => {
			if (stopped) return;
			battery = b;
			b.addEventListener('chargingchange', emit);
			b.addEventListener('levelchange', emit);
			emit();
		})
		.catch(() => undefined);
	emit();

	return () => {
		stopped = true;
		if (timer !== undefined) clearTimeout(timer);
		for (const type of INPUT_EVENTS) window.removeEventListener(type, busy, options);
		document.removeEventListener('visibilitychange', emit);
		nav.connection?.removeEventListener('change', emit);
		battery?.removeEventListener('chargingchange', emit);
		battery?.removeEventListener('levelchange', emit);
	};
}
