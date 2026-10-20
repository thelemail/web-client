import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError } from '$core/api/types';
import { createCredential, getAssertion, webauthnFailure, webauthnFailureMessage } from './webauthn';
import { m } from '$paraglide/messages.js';

const creationOptions = {
	publicKey: {
		rp: { id: 'localhost', name: 'Thelemail' },
		user: { id: 'dXNlcg', name: 'ada@thelemail.com', displayName: 'Ada' },
		challenge: 'Y2hhbGxlbmdl',
		pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
		authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
		excludeCredentials: [{ id: 'a2V5', type: 'public-key' }]
	}
};

const requestOptions = {
	publicKey: {
		challenge: 'Y2hhbGxlbmdl',
		rpId: 'localhost',
		userVerification: 'required',
		allowCredentials: [{ id: 'a2V5', type: 'public-key' }]
	}
};

const credentials = { create: vi.fn(), get: vi.fn() };

function rejectWith(name: string) {
	const error = new DOMException('browser said no', name);
	credentials.create.mockRejectedValue(error);
	credentials.get.mockRejectedValue(error);
}

async function registrationFailure(name: string) {
	rejectWith(name);
	return webauthnFailure(await createCredential(creationOptions).catch((err: unknown) => err));
}

async function authenticationFailure(name: string) {
	rejectWith(name);
	return webauthnFailure(await getAssertion(requestOptions).catch((err: unknown) => err));
}

describe('webauthnFailure', () => {
	beforeEach(() => {
		vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
		Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		credentials.create.mockReset();
		credentials.get.mockReset();
	});

	it('reads a cancelled or timed out registration through the library wrapper', async () => {
		expect(await registrationFailure('NotAllowedError')).toBe('notAllowed');
	});

	it('reads a cancelled or timed out assertion through the library wrapper', async () => {
		expect(await authenticationFailure('NotAllowedError')).toBe('notAllowed');
	});

	it('reads aborted ceremonies from either direction', async () => {
		expect(await registrationFailure('AbortError')).toBe('aborted');
		expect(await authenticationFailure('AbortError')).toBe('aborted');
	});

	it('reads a key that is already registered', async () => {
		expect(await registrationFailure('InvalidStateError')).toBe('duplicate');
	});

	it('reads a key that cannot verify the user', async () => {
		expect(await registrationFailure('ConstraintError')).toBe('noVerification');
	});

	it('reads unsupported algorithms and unknown authenticator errors', async () => {
		expect(await registrationFailure('NotSupportedError')).toBe('unsupported');
		expect(await registrationFailure('UnknownError')).toBe('unknown');
	});

	it('reads a raw DOMException', () => {
		expect(webauthnFailure(new DOMException('', 'NotAllowedError'))).toBe('notAllowed');
		expect(webauthnFailure(new DOMException('', 'InvalidStateError'))).toBe('duplicate');
	});

	it('leaves API and other errors to the caller', () => {
		expect(webauthnFailure(new ApiCallError(409, null, 'conflict'))).toBeNull();
		expect(webauthnFailure(new TypeError('Failed to fetch'))).toBeNull();
		expect(webauthnFailure(undefined)).toBeNull();
	});

	it('passes the hint to the browser', async () => {
		credentials.create.mockRejectedValue(new DOMException('', 'NotAllowedError'));
		await createCredential(creationOptions, ['security-key']).catch(() => {});
		expect(credentials.create.mock.calls[0][0].publicKey.hints).toEqual(['security-key']);
	});

	it('has a message for every failure the user can act on', () => {
		expect(webauthnFailureMessage('notAllowed')).toBe(m.auth_webauthn_err_not_allowed());
		expect(webauthnFailureMessage('duplicate')).toBe(m.auth_webauthn_err_duplicate());
		expect(webauthnFailureMessage('noVerification')).toBe(m.auth_webauthn_err_no_verification());
	});
});
