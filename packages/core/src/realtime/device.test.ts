import { describe, it, expect, beforeEach } from 'vitest';
import { deviceId } from './device';

describe('device id', () => {
	beforeEach(() => {
		sessionStorage.clear();
	});

	it('is stable across calls', () => {
		const a = deviceId();
		const b = deviceId();
		expect(a).toBe(b);
	});

	it('persists to sessionStorage', () => {
		const id = deviceId();
		expect(sessionStorage.getItem('thelemail.device')).toBe(id);
	});

	it('regenerates when the storage key is cleared', () => {
		const a = deviceId();
		sessionStorage.removeItem('thelemail.device');
		const b = deviceId();
		expect(b).not.toBe(a);
	});

});
