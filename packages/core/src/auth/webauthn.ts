import {
	browserSupportsWebAuthn,
	platformAuthenticatorIsAvailable,
	startAuthentication,
	startRegistration
} from '@simplewebauthn/browser';
import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/browser';

export function webauthnSupported(): boolean {
	return browserSupportsWebAuthn();
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
	if (!browserSupportsWebAuthn()) return false;
	try {
		return await platformAuthenticatorIsAvailable();
	} catch {
		return false;
	}
}

function unwrap<T>(options: unknown): T {
	const o = options as { publicKey?: T };
	return (o?.publicKey ?? options) as T;
}

export async function getAssertion(options: unknown): Promise<AuthenticationResponseJSON> {
	return startAuthentication({
		optionsJSON: unwrap<PublicKeyCredentialRequestOptionsJSON>(options)
	});
}

export async function createCredential(options: unknown): Promise<RegistrationResponseJSON> {
	return startRegistration({
		optionsJSON: unwrap<PublicKeyCredentialCreationOptionsJSON>(options)
	});
}

export function isWebauthnCancelled(err: unknown): boolean {
	return (
		err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')
	);
}
