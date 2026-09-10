export interface BackoffOptions {
	baseMs: number;
	maxMs: number;
	factor: number;
	jitter: number;
}

const DEFAULTS: BackoffOptions = { baseMs: 1000, maxMs: 30000, factor: 2, jitter: 0.3 };

export function nextDelay(
	attempt: number,
	opts: Partial<BackoffOptions> = {},
	random: () => number = Math.random
): number {
	const cfg = { ...DEFAULTS, ...opts };
	const raw = Math.min(cfg.maxMs, cfg.baseMs * Math.pow(cfg.factor, Math.max(0, attempt)));
	const jitterRange = raw * cfg.jitter;
	const delta = (random() * 2 - 1) * jitterRange;
	return Math.max(0, Math.round(raw + delta));
}
