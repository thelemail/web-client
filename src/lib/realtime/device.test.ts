import { describe, it, expect, beforeEach } from 'vitest';
import { deviceId, localDeviceIds, noteLocalDevice, forgetLocalDevice } from './device';

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

	it('registers itself as a local device', () => {
		const id = deviceId();
		expect(localDeviceIds().has(id)).toBe(true);
	});

	it('tracks noted and forgotten devices', () => {
		noteLocalDevice('tab-x');
		expect(localDeviceIds().has('tab-x')).toBe(true);
		forgetLocalDevice('tab-x');
		expect(localDeviceIds().has('tab-x')).toBe(false);
	});
});
