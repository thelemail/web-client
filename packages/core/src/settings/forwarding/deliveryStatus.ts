import type { ForwardDelivery, ForwardDeliveryStatus, ReadDelegation } from '$core/api/readDelegations';

const LABELS: Record<ForwardDeliveryStatus, string> = {
	pending: 'Sending',
	sending: 'Sending',
	queued: 'Sending',
	delivered: 'Delivered',
	failed: 'Not delivered',
	not_forwarded_encrypted: 'Not forwarded: it arrived encrypted to this address alone',
	not_forwarded_missing_copy: "Not forwarded: the sender's app did not include a copy",
	not_forwarded_spam: 'Not forwarded: held as spam',
	loop_suppressed: 'Not forwarded: it would have looped back'
};

export function deliveryLabel(status: ForwardDeliveryStatus): string {
	return LABELS[status] ?? status;
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
