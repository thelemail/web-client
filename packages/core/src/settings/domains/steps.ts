import type { CustomDomain, CustomDomainStatus, DNSRecordPhase } from '$core/api/customDomains';
import { m } from '$paraglide/messages.js';

export type DomainStep = 'ownership' | 'sending' | 'recipients' | 'routing' | 'done';

export const DOMAIN_STEPS: DomainStep[] = ['ownership', 'sending', 'recipients', 'routing', 'done'];

export const STEP_LABELS: Record<DomainStep, () => string> = {
	ownership: () => m.settings_domains_step_ownership(),
	sending: () => m.settings_domains_step_sending(),
	recipients: () => m.settings_domains_step_recipients(),
	routing: () => m.settings_domains_step_routing(),
	done: () => m.settings_domains_step_done()
};

export const STEP_PHASE: Partial<Record<DomainStep, DNSRecordPhase>> = {
	ownership: 'ownership',
	sending: 'sending',
	routing: 'routing'
};

export function nextStep(s: DomainStep): DomainStep {
	const i = DOMAIN_STEPS.indexOf(s);
	return DOMAIN_STEPS[Math.min(i + 1, DOMAIN_STEPS.length - 1)];
}

export function previousStep(s: DomainStep): DomainStep {
	const i = DOMAIN_STEPS.indexOf(s);
	return DOMAIN_STEPS[Math.max(i - 1, 0)];
}

export function isDomainStep(v: string | null | undefined): v is DomainStep {
	return !!v && (DOMAIN_STEPS as string[]).includes(v);
}

export function ownershipProven(d: CustomDomain): boolean {
	return !!d.ownershipVerifiedAt;
}

export function canSend(d: CustomDomain): boolean {
	return ownershipProven(d) && !!d.dkimVerifiedAt && !!d.spfVerifiedAt && !!d.dmarcVerifiedAt;
}

export function inboundLive(d: CustomDomain): boolean {
	return canSend(d) && !!d.mxVerifiedAt;
}

export function resumeStep(d: CustomDomain): DomainStep {
	if (!ownershipProven(d)) return 'ownership';
	if (!canSend(d)) return 'sending';
	if (d.addressCount === 0) return 'recipients';
	if (!d.mxVerifiedAt) return 'routing';
	return 'done';
}

export function stepComplete(d: CustomDomain, step: DomainStep): boolean {
	switch (step) {
		case 'ownership':
			return ownershipProven(d);
		case 'sending':
			return canSend(d);
		case 'recipients':
			return d.addressCount > 0;
		case 'routing':
			return !!d.mxVerifiedAt;
		case 'done':
			return inboundLive(d) && d.addressCount > 0;
	}
}

export function stepReachable(d: CustomDomain, step: DomainStep): boolean {
	switch (step) {
		case 'ownership':
			return true;
		case 'sending':
		case 'recipients':
		case 'routing':
			return ownershipProven(d);
		case 'done':
			return stepComplete(d, 'done');
	}
}

export function reachableStep(d: CustomDomain, step: DomainStep): DomainStep {
	return stepReachable(d, step) ? step : resumeStep(d);
}

export function statusLabel(s: CustomDomainStatus): string {
	switch (s) {
		case 'pending':
			return m.settings_domains_status_pending();
		case 'owned':
			return m.settings_domains_status_owned();
		case 'ready':
			return m.settings_domains_status_ready();
		case 'active':
			return m.settings_domains_status_active();
		case 'failed':
			return m.settings_domains_status_failed();
	}
}

export function statusKind(s: CustomDomainStatus): 'ok' | 'warn' | 'info' | 'neutral' {
	switch (s) {
		case 'active':
			return 'ok';
		case 'ready':
		case 'owned':
			return 'info';
		case 'failed':
			return 'warn';
		case 'pending':
			return 'neutral';
	}
}

export function isDormant(d: { dormantAt?: string | null }): boolean {
	return !!d.dormantAt;
}

export function domainBadge(d: {
	status: CustomDomainStatus;
	dormantAt?: string | null;
}): { label: string; kind: 'ok' | 'warn' | 'info' | 'neutral' } {
	if (isDormant(d)) return { label: m.settings_domains_status_paused(), kind: 'warn' };
	return { label: statusLabel(d.status), kind: statusKind(d.status) };
}
