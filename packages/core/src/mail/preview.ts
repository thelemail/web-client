export interface MessagePreviewSender {
	display: string;
	address: string;
}

export type MessagePreviewRecipientKind = 'to' | 'cc' | 'bcc';

export interface MessagePreviewRecipient {
	display: string;
	address: string;
	kind: MessagePreviewRecipientKind;
}

export interface MessagePreviewAuth {
	spf?: string;
	dkim?: string;
	dmarc?: string;
}

export type AuthState = 'pass' | 'fail';

export interface UnsubscribeLinks {
	oneClick?: { url: string; tag: string };
	mailto?: string;
	page?: string;
}

export interface MessagePreview {
	v: number;
	subject: string;
	sender: MessagePreviewSender;
	recipients: MessagePreviewRecipient[];
	snippet: string;
	display_date: string;
	delivered_to?: string;
	flags?: { bimi_domain?: string; auth?: MessagePreviewAuth } & Record<string, unknown>;
}

export function bimiDomainFromPreview(preview: MessagePreview): string | undefined {
	const value = preview.flags?.bimi_domain;
	if (typeof value !== 'string') return undefined;
	const domain = value.trim().toLowerCase();
	return domain ? domain : undefined;
}

export function authSummaryFromPreview(preview: MessagePreview): MessagePreviewAuth | undefined {
	const value = preview.flags?.auth;
	if (typeof value !== 'object' || value === null) return undefined;
	const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : undefined);
	const summary: MessagePreviewAuth = {
		spf: pick(value.spf),
		dkim: pick(value.dkim),
		dmarc: pick(value.dmarc)
	};
	if (!summary.spf && !summary.dkim && !summary.dmarc) return undefined;
	return summary;
}

export function authStateFromPreview(preview: MessagePreview): AuthState | undefined {
	const dmarc = authSummaryFromPreview(preview)?.dmarc;
	if (dmarc === 'pass') return 'pass';
	if (dmarc === 'fail') return 'fail';
	return undefined;
}

const MAX_UNSUBSCRIBE_URI = 2048;
const TAG_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function httpsUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length > MAX_UNSUBSCRIBE_URI) return undefined;
	try {
		const u = new URL(value);
		if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return undefined;
		if (u.port && u.port !== '443') return undefined;
		return value;
	} catch {
		return undefined;
	}
}

function mailtoUri(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length > MAX_UNSUBSCRIBE_URI) return undefined;
	return /^mailto:/i.test(value) ? value : undefined;
}

export function unsubscribeFromPreview(preview: MessagePreview): UnsubscribeLinks | undefined {
	const raw = preview.flags?.unsubscribe;
	if (typeof raw !== 'object' || raw === null) return undefined;
	const value = raw as Record<string, unknown>;
	const links: UnsubscribeLinks = {};
	const oc = value.one_click;
	if (typeof oc === 'object' && oc !== null) {
		const { url, tag } = oc as Record<string, unknown>;
		const safe = httpsUrl(url);
		if (safe && typeof tag === 'string' && TAG_PATTERN.test(tag)) links.oneClick = { url: safe, tag };
	}
	const mailto = mailtoUri(value.mailto);
	if (mailto) links.mailto = mailto;
	const page = httpsUrl(value.https);
	if (page) links.page = page;
	return links.oneClick || links.mailto || links.page ? links : undefined;
}
