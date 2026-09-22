import type { CustomDomain, CustomDomainStatus, DNSRecordPhase } from '$core/api/customDomains';
import { m } from '$paraglide/messages.js';

export type DomainStep = 'ownership' | 'sending' | 'recipients' | 'routing' | 'done';
export type CheckStage = DNSRecordPhase;
export type StageCheckState = 'idle' | 'running' | 'expired' | 'verified';
export type BadgeKind = 'ok' | 'warn' | 'info' | 'neutral';

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

function claimed(d: CustomDomain): boolean {
	return d.status !== 'pending';
}

export function ownershipVerified(d: CustomDomain): boolean {
	return claimed(d) && !!d.ownershipVerifiedAt;
}

export function sendingVerified(d: CustomDomain): boolean {
	return ownershipVerified(d) && !!d.dkimVerifiedAt && !!d.spfVerifiedAt && !!d.dmarcVerifiedAt;
}

export function routingVerified(d: CustomDomain): boolean {
	return sendingVerified(d) && !!d.mxVerifiedAt;
}

export function ownershipLapsing(d: CustomDomain): boolean {
	return ownershipVerified(d) && !!d.ownershipMissingSince;
}

export function ownershipProven(d: CustomDomain): boolean {
	return ownershipVerified(d) && !isDormant(d);
}

export function canSend(d: CustomDomain): boolean {
	return sendingVerified(d) && !isDormant(d);
}

export function inboundLive(d: CustomDomain): boolean {
	return routingVerified(d) && !isDormant(d);
}

export function usable(d: CustomDomain): boolean {
	return canSend(d) && !ownershipLapsing(d);
}

export function resumeStep(d: CustomDomain): DomainStep {
	if (!stepComplete(d, 'ownership')) return 'ownership';
	if (!sendingVerified(d)) return 'sending';
	if (d.addressCount === 0) return 'recipients';
	if (!d.mxVerifiedAt) return 'routing';
	return 'done';
}

export function stepComplete(d: CustomDomain, step: DomainStep): boolean {
	switch (step) {
		case 'ownership':
			return ownershipVerified(d) && !d.ownershipMissingSince;
		case 'sending':
			return sendingVerified(d);
		case 'recipients':
			return sendingVerified(d) && d.addressCount > 0;
		case 'routing':
			return routingVerified(d);
		case 'done':
			return routingVerified(d) && d.addressCount > 0;
	}
}

export function stepReachable(d: CustomDomain, step: DomainStep): boolean {
	switch (step) {
		case 'ownership':
			return true;
		case 'sending':
			return ownershipVerified(d);
		case 'recipients':
			return sendingVerified(d);
		case 'routing':
			return sendingVerified(d) && d.addressCount > 0;
		case 'done':
			return stepComplete(d, 'done');
	}
}

export function reachableStep(d: CustomDomain, step: DomainStep): DomainStep {
	return stepReachable(d, step) ? step : resumeStep(d);
}

function stageVerified(d: CustomDomain, stage: CheckStage): boolean {
	switch (stage) {
		case 'ownership':
			return stepComplete(d, 'ownership');
		case 'sending':
			return sendingVerified(d);
		case 'routing':
			return routingVerified(d);
	}
}

export function stageCheckState(d: CustomDomain, stage: CheckStage): StageCheckState {
	if (stageVerified(d, stage)) return 'verified';
	const c = d.check;
	if (!c || c.stage !== stage) return 'idle';
	return c.state;
}

export function checkRunning(d: CustomDomain): boolean {
	return d.check?.state === 'running';
}

export function canRequestCheck(d: CustomDomain, stage: CheckStage, manage: boolean): boolean {
	if (!manage || checkRunning(d) || d.actionableStage !== stage) return false;
	const state = stageCheckState(d, stage);
	return state === 'idle' || state === 'expired';
}

export function stepRunning(d: CustomDomain, step: DomainStep): boolean {
	const stage = STEP_PHASE[step];
	return !!stage && stageCheckState(d, stage) === 'running';
}

export function reasonStage(code: string | null | undefined): CheckStage | null {
	switch (code) {
		case 'ownership_missing':
		case 'ownership_mismatch':
		case 'ownership_wildcard':
		case 'claimed_elsewhere':
			return 'ownership';
		case 'dkim_missing':
		case 'dkim_mismatch':
		case 'spf_missing':
		case 'spf_mismatch':
		case 'dmarc_missing':
			return 'sending';
		case 'mx_missing':
		case 'mx_mismatch':
			return 'routing';
		default:
			return null;
	}
}

export function reasonStands(d: CustomDomain, code: string | null | undefined): boolean {
	if (!code) return false;
	const stage = reasonStage(code);
	return stage ? stageCheckState(d, stage) !== 'verified' : !stepComplete(d, 'done');
}

export function reasonMessage(code: string | null | undefined): string | null {
	if (!code) return null;
	switch (code) {
		case 'ownership_missing':
			return m.settings_domains_reason_ownership_missing();
		case 'ownership_mismatch':
			return m.settings_domains_reason_ownership_mismatch();
		case 'ownership_wildcard':
			return m.settings_domains_reason_ownership_wildcard();
		case 'claimed_elsewhere':
			return m.settings_domains_reason_claimed_elsewhere();
		case 'dkim_missing':
			return m.settings_domains_reason_dkim_missing();
		case 'dkim_mismatch':
			return m.settings_domains_reason_dkim_mismatch();
		case 'spf_missing':
			return m.settings_domains_reason_spf_missing();
		case 'spf_mismatch':
			return m.settings_domains_reason_spf_mismatch();
		case 'dmarc_missing':
			return m.settings_domains_reason_dmarc_missing();
		case 'mx_missing':
			return m.settings_domains_reason_mx_missing();
		case 'mx_mismatch':
			return m.settings_domains_reason_mx_mismatch();
		case 'dns_unavailable':
			return m.settings_domains_reason_dns_unavailable();
		default:
			return m.settings_domains_reason_unknown();
	}
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

export function statusKind(s: CustomDomainStatus): BadgeKind {
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

const VERIFYING: Record<CheckStage, () => string> = {
	ownership: () => m.settings_domains_status_verifying_ownership(),
	sending: () => m.settings_domains_status_verifying_sending(),
	routing: () => m.settings_domains_status_verifying_routing()
};

export function domainBadge(d: CustomDomain): { label: string; kind: BadgeKind } {
	if (ownershipLapsing(d)) return { label: m.settings_domains_status_lapsing(), kind: 'warn' };
	if (isDormant(d)) return { label: m.settings_domains_status_paused(), kind: 'warn' };
	if (d.check?.state === 'running') return { label: VERIFYING[d.check.stage](), kind: 'info' };
	if (d.check?.state === 'expired') return { label: m.settings_domains_status_expired(), kind: 'warn' };
	return { label: statusLabel(d.status), kind: statusKind(d.status) };
}
