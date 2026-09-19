import { m } from '$paraglide/messages.js';
import type { ForwardDelivery, ForwardDeliveryStatus, ReadDelegation } from '$core/api/readDelegations';

const LABELS: Record<ForwardDeliveryStatus, () => string> = {
	pending: m.settings_forwarding_status_sending,
	sending: m.settings_forwarding_status_sending,
	queued: m.settings_forwarding_status_sending,
	delivered: m.settings_forwarding_status_delivered,
	failed: m.settings_forwarding_status_failed,
	not_forwarded_encrypted: m.settings_forwarding_status_encrypted,
	not_forwarded_missing_copy: m.settings_forwarding_status_missing_copy,
	not_forwarded_needs_key: m.settings_forwarding_status_needs_key,
	not_forwarded_spam: m.settings_forwarding_status_spam,
	loop_suppressed: m.settings_forwarding_status_loop
};

export function deliveryLabel(status: ForwardDeliveryStatus): string {
	return LABELS[status]?.() ?? status;
}

export function deliveryTone(status: ForwardDeliveryStatus): 'ok' | 'warn' | 'neutral' {
	if (status === 'delivered') return 'ok';
	if (status === 'pending' || status === 'sending' || status === 'queued') return 'neutral';
	return 'warn';
}

export interface DeliverySummary {
	delivered: number;
	skipped: number;
	failed: number;
	latest: ForwardDelivery | null;
}

export function summarise(d: ReadDelegation): DeliverySummary {
	const out: DeliverySummary = { delivered: 0, skipped: 0, failed: 0, latest: d.recent[0] ?? null };
	for (const r of d.recent) {
		if (r.status === 'delivered') out.delivered++;
		else if (r.status === 'failed') out.failed++;
		else if (deliveryTone(r.status) === 'warn') out.skipped++;
	}
	return out;
}
