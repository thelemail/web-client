export const INDICATOR_DELAY_MS = 300;
export const INDICATOR_MIN_MS = 250;

export interface DelayedOptions {
	delay?: number;
	minVisible?: number;
	key?: () => unknown;
}

export interface Delayed {
	readonly visible: boolean;
}

export function delayed(active: () => boolean, options: DelayedOptions = {}): Delayed {
	const delay = options.delay ?? INDICATOR_DELAY_MS;
	const minVisible = options.minVisible ?? INDICATOR_MIN_MS;
	const key = options.key ?? (() => null);

	let shownFor = $state<{ key: unknown } | null>(null);
	let shownAt = 0;

	$effect(() => {
		const on = active();
		const k = key();
		const showing = shownFor !== null && shownFor.key === k;
		if (on && !showing) {
			const timer = setTimeout(() => {
				shownFor = { key: k };
				shownAt = Date.now();
			}, delay);
			return () => clearTimeout(timer);
		}
		if (!on && shownFor !== null) {
			if (!showing) {
				shownFor = null;
				return;
			}
			const timer = setTimeout(
				() => (shownFor = null),
				Math.max(0, minVisible - (Date.now() - shownAt))
			);
			return () => clearTimeout(timer);
		}
	});

	return {
		get visible() {
			return shownFor !== null && shownFor.key === key();
		}
	};
}
