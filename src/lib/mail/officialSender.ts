import { isOfficialAddress, isOfficialFingerprint } from '$lib/directory/official';
import { splitMimeHeaders } from '$lib/mail/render/mimeHeaders';
import { parseMailbox } from '$lib/mail/address';
import type { SignatureVerdict } from '$lib/keystore/protocol';
import type { Channel } from './trust';

export interface OfficialFacts {
	claimed: boolean;
	signedByOfficial: boolean;
	headerBound: boolean;
	channelOk: boolean;
}

interface OfficialFactsInput {
	senderAddress: string;
	channel: Channel;
	signature?: SignatureVerdict;
	signedMime?: string;
}

function unfold(headers: string): string {
	return headers.replace(/\r?\n[ \t]+/g, ' ');
}

function headerValue(headers: string, name: string): string | undefined {
	const needle = name.toLowerCase() + ':';
	for (const line of unfold(headers).split(/\r?\n/)) {
		if (line.toLowerCase().startsWith(needle)) {
			return line.slice(needle.length).trim();
		}
	}
	return undefined;
}

export function signedFromAddress(mime: string | undefined): string | undefined {
	if (!mime) return undefined;
	const headers = splitMimeHeaders(mime);
	if (!headers) return undefined;
	const from = headerValue(headers, 'from');
	if (!from) return undefined;
	const mailbox = parseMailbox(from);
	return mailbox.address ? mailbox.address.toLowerCase() : undefined;
}

export function officialFacts(input: OfficialFactsInput): OfficialFacts {
	const claimed = isOfficialAddress(input.senderAddress);
	if (!claimed) {
		return { claimed: false, signedByOfficial: false, headerBound: false, channelOk: false };
	}
	const signedByOfficial =
		input.signature?.state === 'valid' && isOfficialFingerprint(input.signature.keyFingerprintHex);
	const signedFrom = signedFromAddress(input.signedMime);
	return {
		claimed: true,
		signedByOfficial,
		headerBound: signedFrom === input.senderAddress.trim().toLowerCase(),
		channelOk: input.channel === 'internal'
	};
}
