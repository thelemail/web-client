import {
	browserSupportsWebAuthn,
	platformAuthenticatorIsAvailable,
	startAuthentication,
	startRegistration,
	WebAuthnError
} from '@simplewebauthn/browser';
import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialHint,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/browser';
import { m } from '$paraglide/messages.js';

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

export async function createCredential(
	options: unknown,
	hints?: PublicKeyCredentialHint[]
): Promise<RegistrationResponseJSON> {
	const optionsJSON = unwrap<PublicKeyCredentialCreationOptionsJSON>(options);
	return startRegistration({ optionsJSON: hints ? { ...optionsJSON, hints } : optionsJSON });
}

export type WebauthnFailure =
	| 'aborted'
	| 'notAllowed'
	| 'duplicate'
	| 'noVerification'
	| 'unsupported'
	| 'security'
	| 'unknown';

const NAMED: Record<string, WebauthnFailure> = {
	AbortError: 'aborted',
	NotAllowedError: 'notAllowed',
	InvalidStateError: 'duplicate',
	ConstraintError: 'noVerification',
	NotSupportedError: 'unsupported',
	SecurityError: 'security'
};

const CODED: Record<string, WebauthnFailure> = {
	ERROR_CEREMONY_ABORTED: 'aborted',
	ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: 'duplicate',
	ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT: 'noVerification',
	ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE: 'noVerification',
	ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT: 'unsupported',
	ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG: 'unsupported',
	ERROR_INVALID_DOMAIN: 'security',
	ERROR_INVALID_RP_ID: 'security'
};

export function webauthnFailure(err: unknown): WebauthnFailure | null {
	if (err instanceof WebAuthnError) {
		const cause = err.cause instanceof Error ? err.cause.name : '';
		return CODED[err.code] ?? NAMED[err.name] ?? NAMED[cause] ?? 'unknown';
	}
	if (err instanceof DOMException) return NAMED[err.name] ?? 'unknown';
	return null;
}

export function webauthnFailureMessage(failure: WebauthnFailure): string {
	switch (failure) {
		case 'notAllowed':
			return m.auth_webauthn_err_not_allowed();
		case 'duplicate':
			return m.auth_webauthn_err_duplicate();
		case 'noVerification':
			return m.auth_webauthn_err_no_verification();
		case 'unsupported':
			return m.auth_webauthn_err_unsupported();
		case 'security':
			return m.auth_webauthn_err_security();
		default:
			return m.auth_webauthn_err_unknown();
	}
}
