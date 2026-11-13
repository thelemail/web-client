import { describe, expect, it } from 'vitest';
import { Latest } from './latest';

describe('Latest', () => {
	it('treats only the newest token as current', () => {
		const latest = new Latest();
		const first = latest.begin();
		const second = latest.begin();
		expect(latest.isCurrent(first)).toBe(false);
		expect(latest.isCurrent(second)).toBe(true);
	});

	it('drops every outstanding token on invalidate', () => {
		const latest = new Latest();
		const token = latest.begin();
		latest.invalidate();
		expect(latest.isCurrent(token)).toBe(false);
	});
});
