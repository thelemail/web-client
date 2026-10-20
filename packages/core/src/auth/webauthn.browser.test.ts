import { afterEach, describe, expect, it } from 'vitest';
import { commands, server } from 'vitest/browser';
import { WebAuthnAbortService, bufferToBase64URLString } from '@simplewebauthn/browser';
import { createCredential, getAssertion, webauthnFailure } from './webauthn';

declare module 'vitest/browser' {
	interface BrowserCommands {
		addVirtualAuthenticator: (options: {
			transport: 'usb' | 'internal';
			hasUserVerification: boolean;
			isUserVerified: boolean;
		}) => Promise<string>;
		removeVirtualAuthenticator: (authenticatorId: string) => Promise<void>;
	}
}

const yubikey = { transport: 'usb', hasUserVerification: true, isUserVerified: true } as const;

function random(bytes: number): string {
	return bufferToBase64URLString(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

function registration(exclude: string[] = []) {
	return {
		publicKey: {
			rp: { id: location.hostname, name: 'Thelemail' },
			user: { id: random(16), name: 'ada@thelemail.com', displayName: 'Ada' },
			challenge: random(32),
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
			timeout: 30000,
			attestation: 'none',
			authenticatorSelection: {
				authenticatorAttachment: 'cross-platform',
				residentKey: 'preferred',
				userVerification: 'required'
			},
			excludeCredentials: exclude.map((id) => ({ id, type: 'public-key', transports: ['usb'] }))
		}
	};
}

function assertion(allow: string[]) {
	return {
		publicKey: {
			challenge: random(32),
			rpId: location.hostname,
			timeout: 30000,
			userVerification: 'required',
			allowCredentials: allow.map((id) => ({ id, type: 'public-key', transports: ['usb'] }))
		}
	};
}

async function failure(run: Promise<unknown>) {
	return webauthnFailure(await run.then(() => null, (err: unknown) => err));
}

describe.runIf(server.browser === 'chromium')('security key on a virtual USB authenticator', () => {
	const added: string[] = [];

	async function plugIn(options: Parameters<typeof commands.addVirtualAuthenticator>[0] = yubikey) {
		const id = await commands.addVirtualAuthenticator(options);
		added.push(id);
		return id;
	}

	afterEach(async () => {
		while (added.length > 0) await commands.removeVirtualAuthenticator(added.pop()!);
	});

	it('enrolls with user verification and signs in with the same key', async () => {
		await plugIn();
		const created = await createCredential(registration(), ['security-key']);
		expect(created.response.transports).toContain('usb');
		expect(created.authenticatorAttachment).toBe('cross-platform');

		const signed = await getAssertion(assertion([created.id]));
		expect(signed.id).toBe(created.id);
	});

	it('enrolls a second key after confirming with the first', async () => {
		const first = await plugIn();
		const existing = await createCredential(registration(), ['security-key']);
		expect((await getAssertion(assertion([existing.id]))).id).toBe(existing.id);

		await commands.removeVirtualAuthenticator(first);
		added.splice(added.indexOf(first), 1);
		await plugIn();
		const second = await createCredential(registration([existing.id]), ['security-key']);
		expect(second.id).not.toBe(existing.id);
	});

	it('reads a key that is already registered', async () => {
		await plugIn();
		const created = await createCredential(registration(), ['security-key']);
		expect(await failure(createCredential(registration([created.id]), ['security-key']))).toBe('duplicate');
	});

	it('reads a key that fails user verification as closed, not as a server error', async () => {
		await plugIn({ transport: 'usb', hasUserVerification: true, isUserVerified: false });
		expect(await failure(createCredential(registration(), ['security-key']))).toBe('notAllowed');
	});

	it('reads a key that is not registered for this account as closed', async () => {
		await plugIn();
		expect(await failure(getAssertion(assertion([random(32)])))).toBe('notAllowed');
	});

	it('reads a ceremony replaced by a newer one as aborted', async () => {
		await plugIn({ transport: 'usb', hasUserVerification: true, isUserVerified: true });
		const pending = getAssertion(assertion([random(32)]));
		WebAuthnAbortService.cancelCeremony();
		expect(await failure(pending)).toBe('aborted');
	});
});

describe('WebAuthn errors from the browser itself', () => {
	it('read an aborted request as aborted', async () => {
		const request = navigator.credentials.get({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				rpId: location.hostname,
				userVerification: 'required'
			},
			signal: AbortSignal.abort()
		});
		expect(await failure(request)).toBe('aborted');
	});
});
