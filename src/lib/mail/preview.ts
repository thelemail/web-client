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

export interface MessagePreview {
	v: number;
	subject: string;
	sender: MessagePreviewSender;
	recipients: MessagePreviewRecipient[];
	snippet: string;
	display_date: string;
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

export function authBadgeTitle(state: AuthState, detail?: MessagePreviewAuth): string {
	const head = state === 'pass' ? 'Authenticated' : 'Failed authentication';
	const parts = [
		detail?.spf ? `SPF: ${detail.spf}` : '',
		detail?.dkim ? `DKIM: ${detail.dkim}` : '',
		detail?.dmarc ? `DMARC: ${detail.dmarc}` : ''
	].filter(Boolean);
	return parts.length ? `${head} — ${parts.join(' · ')}` : head;
}
