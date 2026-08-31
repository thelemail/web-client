import { getMessageThread } from '$lib/api/messages';
import type { MessageDetail } from '$lib/api/types';
import {
	authStateFromPreview,
	authSummaryFromPreview,
	bimiDomainFromPreview
} from '$lib/mail/preview';
import { decryptPreview, DecryptionError } from '$lib/mail/decrypt';
import { isOfficialAddress, OFFICIAL_KEYS_ARMORED } from '$lib/directory/official';
import { officialFacts } from './officialSender';
import { directoryTrust, externalKeyState } from '$lib/mail/senderVerify';
import { deriveTrust, type TrustFacts } from '$lib/mail/trust';
import { renderBody, type RenderResult } from '$lib/mail/render';
import type { SignatureVerdict } from '$lib/keystore/protocol';
import { renderDetail } from '$lib/mail/bodySource';
import { detailFromMirror } from '$lib/mail/mirrorDetail';
import { platform } from '$platform';
import type { MirrorMessage } from '$lib/platform/types';
import type { MessagePreview } from '$lib/mail/preview';
import { initialsFor } from '$lib/mail/initials';
import { paletteFor } from '$lib/mail/avatarPalette';
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
	stripTracking: boolean,
	cached?: MirrorMessage
): Promise<ThreadEntry | null> {
	try {
		const preview = cached ? previewFromMirror(cached) : await decryptPreview(accountId, item.encryptedPreview);
		const fromDisplay = preview.sender.display || preview.sender.address || 'Unknown';
		const init = initialsFor(fromDisplay, preview.sender.address);
		const pal = paletteFor(preview.sender.address.toLowerCase());
		const stored = new Date(item.storedAt);
		const me = auth.email
			? preview.sender.address.toLowerCase() === auth.email.toLowerCase()
			: false;

		const senderAddress = preview.sender.address;
		const claimsOfficial = isOfficialAddress(senderAddress);
		const directory =
			item.source === 'internal' && !me && senderAddress
				? await directoryTrust(accountId, senderAddress).catch(() => null)
				: null;

		let bodyLines: string[] = [preview.snippet || '(empty)'];
		let render: RenderResult | null = null;
		let signature: SignatureVerdict | undefined;
		let signedMime: string | undefined;
		try {
			const rendered = await renderDetail(
				accountId,
				item,
				{
					stripTracking,
					verificationKeysArmored: claimsOfficial
						? [...OFFICIAL_KEYS_ARMORED]
						: directory?.publicKeyArmored
							? [directory.publicKeyArmored]
							: undefined
				},
				cached?.mime ?? undefined
			);
			render = rendered.render;
			signature = rendered.signature;
			signedMime = rendered.mime;
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
				? await externalKeyState(senderAddress).catch(() => null)
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
			official: officialFacts({ senderAddress, channel: item.source, signature, signedMime }),
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
			bg: me ? 'var(--pine-700)' : pal.bg,
			fg: me ? '#EEF2EA' : pal.fg,
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

function previewFromMirror(m: MirrorMessage): MessagePreview {
	let recipients: MessagePreview['recipients'] = [];
	try {
		const parsed = JSON.parse(m.recipientsJson) as string[];
		recipients = parsed.map((address) => ({ display: '', address, kind: 'to' as const }));
	} catch {
		recipients = [];
	}
	return {
		v: 1,
		subject: m.subject,
		sender: { display: m.senderDisplay, address: m.senderAddress },
		recipients,
		snippet: m.snippet,
		display_date: m.displayDate
	} as MessagePreview;
}

interface ThreadSource {
	threadRootId?: string;
	items: MessageDetail[];
	cached?: Map<string, MirrorMessage>;
}

async function loadThread(accountId: string, messageId: string): Promise<ThreadSource | null> {
	try {
		return await getMessageThread(messageId);
	} catch (err) {
		const mirror = platform.mirror;
		if (!mirror) throw err;
		const cached = await mirror.thread(accountId, messageId).catch(() => []);
		if (cached.length === 0) throw err;
		return {
			items: cached.map(detailFromMirror),
			cached: new Map(cached.map((m) => [m.id, m]))
		};
	}
}

export async function hydrateThread(messageId: string): Promise<HydratedThread | null> {
	const accountId = auth.accountId;
	if (!accountId) return null;
	const resp = await loadThread(accountId, messageId);
	if (!resp || !resp.items || resp.items.length === 0) return null;

	const seed = resp.items.find((it) => it.id === messageId) ?? resp.items[resp.items.length - 1];
	const stripTracking = accountSettings.privacy.stripTrackingParams;

	const hydrated = await mapLimit(resp.items, HYDRATE_CONCURRENCY, (item) =>
		hydrateEntry(accountId, item, stripTracking, resp.cached?.get(item.id))
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
