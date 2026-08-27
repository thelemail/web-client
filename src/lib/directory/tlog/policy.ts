import { env } from '$env/dynamic/public';
import { bytesFromBase64 } from './bytes';
import { parseVerifierKey } from './note';

export type TlogMode = 'monitor' | 'enforce';

export interface TlogPolicy {
	origin: string;
	logVerifierKey: string;
	vrfPublicKey: string;
	witnessVerifierKeys: string[] | null;
	witnessThreshold: number;
	maxCosignatureAgeSeconds: number;
}

export interface TlogRuntimePolicy extends TlogPolicy {
	mode: TlogMode;
}

function loadPolicy(): TlogRuntimePolicy | null {
	const raw = env.PUBLIC_TLOG_POLICY;
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('PUBLIC_TLOG_POLICY is not valid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('PUBLIC_TLOG_POLICY must be a JSON object');
	}
	const p = parsed as Record<string, unknown>;
	if (typeof p.origin !== 'string' || p.origin.length === 0) {
		throw new Error('PUBLIC_TLOG_POLICY: origin must be a non-empty string');
	}
	if (typeof p.logVerifierKey !== 'string') {
		throw new Error('PUBLIC_TLOG_POLICY: logVerifierKey must be a string');
	}
	parseVerifierKey(p.logVerifierKey);
	if (typeof p.vrfPublicKey !== 'string' || bytesFromBase64(p.vrfPublicKey).length !== 32) {
		throw new Error('PUBLIC_TLOG_POLICY: vrfPublicKey must be base64 of 32 bytes');
	}
	let witnessVerifierKeys: string[] | null = null;
	if (p.witnessVerifierKeys != null) {
		if (
			!Array.isArray(p.witnessVerifierKeys) ||
			p.witnessVerifierKeys.some((k) => typeof k !== 'string')
		) {
			throw new Error('PUBLIC_TLOG_POLICY: witnessVerifierKeys must be an array of strings');
		}
		for (const k of p.witnessVerifierKeys) parseVerifierKey(k);
		witnessVerifierKeys = p.witnessVerifierKeys;
	}
	if (typeof p.witnessThreshold !== 'number' || !Number.isInteger(p.witnessThreshold) || p.witnessThreshold < 0) {
		throw new Error('PUBLIC_TLOG_POLICY: witnessThreshold must be a non-negative integer');
	}
	if (
		typeof p.maxCosignatureAgeSeconds !== 'number' ||
		!Number.isFinite(p.maxCosignatureAgeSeconds) ||
		p.maxCosignatureAgeSeconds <= 0
	) {
		throw new Error('PUBLIC_TLOG_POLICY: maxCosignatureAgeSeconds must be a positive number');
	}
	if (p.mode !== 'monitor' && p.mode !== 'enforce') {
		throw new Error('PUBLIC_TLOG_POLICY: mode must be "monitor" or "enforce"');
	}
	return {
		origin: p.origin,
		logVerifierKey: p.logVerifierKey,
		vrfPublicKey: p.vrfPublicKey,
		witnessVerifierKeys,
		witnessThreshold: p.witnessThreshold,
		maxCosignatureAgeSeconds: p.maxCosignatureAgeSeconds,
		mode: p.mode
	};
}

export const TLOG_POLICY: TlogRuntimePolicy | null = loadPolicy();
