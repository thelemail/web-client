import { getMessageThread } from '$lib/api/messages';
import type { MessageDetail } from '$lib/api/types';
import {
	authStateFromPreview,
	authSummaryFromPreview,
	bimiDomainFromPreview
} from '$lib/mail/preview';
import { decryptPreview, DecryptionError } from '$lib/mail/decrypt';
import { directoryTrust, externalKeyState } from '$lib/mail/senderVerify';
import { deriveTrust, type TrustFacts } from '$lib/mail/trust';
import { renderBody, type RenderResult } from '$lib/mail/render';
import type { SignatureVerdict } from '$lib/keystore/protocol';
import { renderDetail } from '$lib/mail/bodySource';
import { initialsFor } from '$lib/mail/initials';
import { initialChips } from '$lib/mail/attachments';
import { type ThreadEntry, type Message } from '$lib/mail/data';
import { auth } from '$lib/stores/auth.svelte';
import { accountSettings } from '$lib/stores/accountSettings.svelte';

export interface HydratedThread {
	entries: ThreadEntry[];
	rsvpStatus?: Message['rsvpStatus'];
	rsvpEventUid?: string;
	externalMessageId?: string;
	references?: string[];
}

const HYDRATE_CONCURRENCY = 3;

async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

async function hydrateEntry(
	accountId: string,
	item: MessageDetail,
	stripTracking: boolean
): Promise<ThreadEntry | null> {
	try {
		const preview = await decryptPreview(accountId, item.encryptedPreview);
		const fromDisplay = preview.sender.display || preview.sender.address || 'Unknown';
		const init = initialsFor(fromDisplay, preview.sender.address);
		const stored = new Date(item.storedAt);
		const me = auth.email
			? preview.sender.address.toLowerCase() === auth.email.toLowerCase()
			: false;

		const senderAddress = preview.sender.address;
		const directory =
			item.source === 'internal' && !me && senderAddress
				? await directoryTrust(accountId, senderAddress)
				: null;

		let bodyLines: string[] = [preview.snippet || '(empty)'];
		let render: RenderResult | null = null;
		let signature: SignatureVerdict | undefined;
		try {
			const rendered = await renderDetail(accountId, item, {
				stripTracking,
				verificationKeysArmored: directory?.publicKeyArmored
					? [directory.publicKeyArmored]
					: undefined
			});
			render = rendered.render;
			signature = rendered.signature;
		} catch (err) {
			if (err instanceof DecryptionError) {
				bodyLines = ['(Could not decrypt this message.)'];
			}
		}

		let srcDoc: string;
		let quotedSrcDoc: string | undefined;
		let forwarded: boolean | undefined;
		if (render) {
			srcDoc = render.srcDoc;
			quotedSrcDoc = render.quoted?.srcDoc;
			forwarded = render.forwarded;
		} else {
			srcDoc = (await renderBody({ text: bodyLines.join('\n\n') })).srcDoc;
		}

		const e2e = item.source === 'internal' || item.encrypted === true;
		const externalKey =
			item.source !== 'internal' && !me && e2e && senderAddress
				? await externalKeyState(senderAddress)
				: null;

		const facts: TrustFacts = {
			channel: item.source,
			senderAddress,
			e2e,
			signature,
			directory,
			externalKey,
			domainAuth: authSummaryFromPreview(preview),
			domainAuthState: authStateFromPreview(preview),
			nowMillis: Date.now()
		};
		const trust = me ? undefined : deriveTrust(facts);

		const toAddresses = preview.recipients.filter((r) => r.kind === 'to').map((r) => r.address);
		return {
			id: item.id,
			from: me ? 'You' : fromDisplay,
			fromAddr: preview.sender.address,
			bimiDomain: bimiDomainFromPreview(preview),
			to: toAddresses.length ? toAddresses.join(', ') : (preview.recipients[0]?.address ?? ''),
			recipients: preview.recipients,
			init,
			bg: me ? 'var(--pine-700)' : 'var(--pine-100)',
			fg: me ? '#EEF2EA' : 'var(--pine-700)',
			epoch: stored.getTime(),
			trust,
			me,
			body: bodyLines,
			srcDoc,
			quotedSrcDoc,
			forwarded,
			attachments: initialChips(item.attachments ?? []),
			externalMessageId: item.externalMessageId ?? undefined,
			inReplyTo: item.inReplyTo ?? undefined
		};
	} catch (err) {
		console.warn('Thread row hydration failed', err);
		return null;
	}
}

export async function hydrateThread(messageId: string): Promise<HydratedThread | null> {
	const accountId = auth.accountId;
	if (!accountId) return null;
	const resp = await getMessageThread(messageId);
	if (!resp || !resp.items || resp.items.length === 0) return null;

	const seed = resp.items.find((it) => it.id === messageId) ?? resp.items[resp.items.length - 1];
	const stripTracking = accountSettings.privacy.stripTrackingParams;

	const hydrated = await mapLimit(resp.items, HYDRATE_CONCURRENCY, (item) =>
		hydrateEntry(accountId, item, stripTracking)
	);
	const entries = hydrated.filter((e): e is ThreadEntry => e !== null);

	return {
		entries,
		rsvpStatus: seed.rsvpStatus ?? undefined,
		rsvpEventUid: seed.rsvpEventUid ?? undefined,
		externalMessageId: seed.externalMessageId ?? undefined,
		references: seed.references ?? undefined
	};
}
