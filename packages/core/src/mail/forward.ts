import type { Message } from './data';
import type { MessagePreviewRecipient } from './preview';
import { forwardQuoteHtml, forwardQuoteText, type QuoteSource } from './quote';

export interface ForwardQuote {
	html: string;
	text: string;
}

function partyLine(list: MessagePreviewRecipient[]): string {
	return list
		.map((r) => (r.display && r.display !== r.address ? `${r.display} <${r.address}>` : r.address))
		.join(', ');
}

export function forwardSource(
	msg: Message | null,
	ownName: string,
	html?: string,
	text?: string
): QuoteSource {
	const recipients = msg?.recipients ?? [];
	const to = recipients.filter((r) => r.kind === 'to');
	const cc = recipients.filter((r) => r.kind === 'cc');
	return {
		fromDisplay: msg ? (msg.direction === 'sent' ? ownName : msg.from) : '',
		fromAddress: msg?.fromAddr ?? '',
		toLine: to.length ? partyLine(to) : (msg?.to ?? ''),
		ccLine: cc.length ? partyLine(cc) : undefined,
		epoch: msg?.epoch ?? Date.now(),
		subject: msg?.subj ?? '',
		html,
		text
	};
}

export function forwardQuote(
	msg: Message | null,
	ownName: string,
	html?: string,
	text?: string
): ForwardQuote {
	const src = forwardSource(msg, ownName, html, text);
	return { html: forwardQuoteHtml(src), text: forwardQuoteText(src) };
}

export function plainToHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/\r?\n/g, '<br>');
}

export function forwardFallbackText(msg: Message | null): string {
	if (!msg) return '';
	const body = msg.body?.length ? msg.body.join('\n\n') : '';
	return (body || msg.prev || '').trim();
}

export function addressedIdentity(
	msg: Message,
	ownAddress: (address: string) => string | null
): string | null {
	const thread = msg.thread ?? [];
	const candidates: (string | undefined)[] = [
		msg.deliveredTo,
		...thread.map((t) => t.deliveredTo),
		msg.fromAddr,
		...(msg.recipients ?? []).map((r) => r.address),
		...thread.flatMap((t) => (t.recipients ?? []).map((r) => r.address))
	];
	for (const address of candidates) {
		if (!address) continue;
		const own = ownAddress(address);
		if (own) return own;
	}
	return null;
}
