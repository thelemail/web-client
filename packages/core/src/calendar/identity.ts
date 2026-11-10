import { ApiCallError } from '$core/api/types';
import type { CalendarIdentityResponse } from '$core/api/calendars';
import { lookupCalendarIdentity } from '$core/api/calendars';
import { bytesToHex } from '$core/crypto';
import { DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX } from '$core/directory/signing-key';
import { parseStatementBytes } from '$core/directory/statement';
import { verifyDirectoryRecord } from '$core/directory/verify';
import type { CalendarAuthority } from '$core/keystore/productkeys/calendar';
import { calendarAuthority } from '$core/keystore/productkeys/calendar';
import { b64decode, sha256 } from '$core/keystore/productkeys/encoding';
import { transcriptHash } from '$core/keystore/productkeys/envelope';
import { DOMAIN, parseDelegation } from '$core/keystore/productkeys/manifests';
import type { CalendarDb } from './db';

export interface CalendarIdentity {
	accountId: string;
	email: string;
	authority: CalendarAuthority;
	signingKey: Uint8Array;
}

export class CalendarIdentityError extends Error {
	code: 'unverified' | 'rolled_back';
	constructor(code: CalendarIdentityError['code'], message: string) {
		super(message);
		this.code = code;
		this.name = 'CalendarIdentityError';
	}
}

const STATEMENT_TYPE = 'thelemail-product-identity-statement/v1';
const STATEMENT_FIELDS = [
	'accountId',
	'authorityEpoch',
	'authorityKeyDigest',
	'delegationHash',
	'delegationRevision',
	'issuedAt',
	'product',
	'signingKeyDigest',
	'signingKeyFingerprint',
	'type',
	'version'
] as const;

interface ProductStatement {
	accountId: string;
	authorityEpoch: number;
	authorityKeyDigest: string;
	delegationHash: string;
	delegationRevision: number;
	product: string;
	signingKeyDigest: string;
	signingKeyFingerprint: string;
}

const unverified = (why: string): never => {
	throw new CalendarIdentityError('unverified', why);
};

function parseProductStatement(raw: Uint8Array): ProductStatement {
	let text: string;
	let o: Record<string, unknown>;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
		o = JSON.parse(text);
	} catch {
		return unverified('identity statement is not JSON');
	}
	if (!o || typeof o !== 'object' || Object.keys(o).length !== STATEMENT_FIELDS.length) unverified('identity statement fields');
	const canon = JSON.stringify(Object.fromEntries(STATEMENT_FIELDS.map((k) => [k, o[k]])));
	if (canon !== text || o.type !== STATEMENT_TYPE) unverified('identity statement is not canonical');
	return o as unknown as ProductStatement;
}

const pinned = () => DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase();

async function verifyAddress(res: CalendarIdentityResponse, address: string): Promise<void> {
	const addressRaw = b64decode(res.addressStatement);
	await verifyDirectoryRecord({
		raw: addressRaw,
		signatureB64: res.addressSignature,
		label: address,
		tlogProof: res.addressTlogProof,
		tlogConsistency: res.addressTlogConsistency,
		refetchConsistency: async (since) => (await lookupCalendarIdentity(address, since)).addressTlogConsistency
	});
	const stmt = parseStatementBytes(addressRaw);
	if (stmt.signingKeyFingerprint !== pinned() || stmt.address.toLowerCase() !== address || stmt.accountId !== res.accountId) {
		unverified('address statement does not bind this account');
	}
}

export async function verifyCalendarIdentity(res: CalendarIdentityResponse, email: string): Promise<CalendarIdentity> {
	const address = email.trim().toLowerCase();
	await verifyAddress(res, address);
	if (res.state !== 'published' || !res.statement || !res.statementSignature || !res.delegations || !res.authorityKey || !res.signingKey || res.authorityEpoch === undefined) {
		return unverified('no published calendar identity');
	}
	const productRaw = b64decode(res.statement);
	const ps = parseProductStatement(productRaw);
	if (ps.signingKeyFingerprint !== pinned() || ps.accountId !== res.accountId || ps.product !== 'calendar') {
		unverified('identity statement does not name this account');
	}
	await verifyDirectoryRecord({
		raw: productRaw,
		signatureB64: res.statementSignature,
		label: `product:calendar:${res.accountId}`,
		tlogProof: res.statementTlogProof,
		tlogConsistency: res.statementTlogConsistency,
		refetchConsistency: async (since) => (await lookupCalendarIdentity(address, since)).statementTlogConsistency
	});

	const chain = [...res.delegations].sort((a, b) => a.revision - b.revision);
	let previous: Uint8Array | null = null;
	for (const [i, d] of chain.entries()) {
		const record = b64decode(d.record);
		const parsed = parseDelegation(record);
		if (parsed.delegationRevision !== i + 1 || d.revision !== i + 1) unverified('delegation history has a gap');
		const link = parsed.previousDelegationHash;
		if ((previous === null) !== (link === null) || (previous && link && bytesToHex(previous) !== bytesToHex(link))) {
			unverified('delegation history does not chain');
		}
		previous = await transcriptHash(DOMAIN.delegation, record);
	}
	const current = chain.at(-1);
	if (!current || !previous) return unverified('no delegation');
	const authorityKey = b64decode(res.authorityKey);
	const signingKey = b64decode(res.signingKey);
	const authority = await calendarAuthority(res.accountId, authorityKey, res.authorityEpoch, b64decode(current.record), b64decode(current.signature), signingKey);
	if (
		ps.delegationHash !== bytesToHex(previous) ||
		ps.delegationRevision !== authority.delegation.delegationRevision ||
		ps.signingKeyDigest !== bytesToHex(authority.signingKeyDigest) ||
		ps.authorityKeyDigest !== bytesToHex(await sha256(authorityKey)) ||
		ps.authorityEpoch !== res.authorityEpoch
	) {
		unverified('identity statement does not match the served delegation');
	}
	return { accountId: res.accountId, email: address, authority, signingKey };
}

const cache = new Map<string, { at: number; recipient: CalendarRecipient }>();
const CACHE_MS = 5 * 60 * 1000;

export type CalendarRecipient =
	| { kind: 'published'; identity: CalendarIdentity }
	| { kind: 'pending'; accountId: string; email: string }
	| { kind: 'external'; email: string };

export async function resolveCalendarIdentity(db: CalendarDb, accountId: string, email: string): Promise<CalendarIdentity | null> {
	const r = await resolveCalendarRecipient(db, accountId, email);
	return r.kind === 'published' ? r.identity : null;
}

export async function resolveCalendarRecipient(db: CalendarDb, accountId: string, email: string): Promise<CalendarRecipient> {
	const address = email.trim().toLowerCase();
	const key = `${accountId} ${address}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.recipient;
	let res: CalendarIdentityResponse;
	try {
		res = await lookupCalendarIdentity(address);
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 404) {
			const recipient: CalendarRecipient = { kind: 'external', email: address };
			cache.set(key, { at: Date.now(), recipient });
			return recipient;
		}
		throw err;
	}
	if (res.state === 'pending') {
		await verifyAddress(res, address);
		const recipient: CalendarRecipient = { kind: 'pending', accountId: res.accountId, email: address };
		cache.set(key, { at: Date.now(), recipient });
		return recipient;
	}
	const identity = await verifyCalendarIdentity(res, address);
	const delegation = identity.authority.delegation;
	const mark = await db.identityMark(accountId, identity.accountId);
	if (mark && (delegation.delegationRevision < mark.delegationRevision || delegation.authorityEpoch < mark.authorityEpoch)) {
		throw new CalendarIdentityError('rolled_back', `${address} served an older calendar identity than this device has seen`);
	}
	await db.putIdentityMark({
		accountId,
		peerAccountId: identity.accountId,
		delegationRevision: delegation.delegationRevision,
		authorityEpoch: delegation.authorityEpoch
	});
	const recipient: CalendarRecipient = { kind: 'published', identity };
	cache.set(key, { at: Date.now(), recipient });
	return recipient;
}

export function forgetCalendarIdentities(email?: string): void {
	if (!email) {
		cache.clear();
		return;
	}
	const address = email.trim().toLowerCase();
	for (const key of [...cache.keys()]) if (key.endsWith(` ${address}`)) cache.delete(key);
}
