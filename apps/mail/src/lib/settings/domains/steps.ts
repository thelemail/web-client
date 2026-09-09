import type { CustomDomain, CustomDomainStatus, DNSRecordPhase } from '$lib/api/customDomains';

export type DomainStep = 'ownership' | 'sending' | 'recipients' | 'routing' | 'done';

export const DOMAIN_STEPS: DomainStep[] = ['ownership', 'sending', 'recipients', 'routing', 'done'];

export const STEP_LABELS: Record<DomainStep, string> = {
	ownership: 'Ownership',
	sending: 'Sending',
	recipients: 'Recipients',
	routing: 'Routing',
	done: 'Done'
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

export function statusLabel(s: CustomDomainStatus): string {
	switch (s) {
		case 'pending':
			return 'Not started';
		case 'owned':
			return 'Ownership verified';
		case 'ready':
			return 'Ready to send';
		case 'active':
			return 'Live';
		case 'failed':
			return 'Needs attention';
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
