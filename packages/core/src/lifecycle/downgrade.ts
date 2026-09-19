import type {
	DowngradeFinding,
	DowngradePreview,
	DowngradeSeverity,
	Subscription
} from '../api/billing';
import { m } from '$paraglide/messages.js';
import { i18n } from '$core/i18n/locale.svelte';

const SEVERITY_ORDER: DowngradeSeverity[] = ['blocker', 'stops', 'warn', 'unaffected'];

const GROUP_HEADINGS: Record<DowngradeSeverity, () => string> = {
	blocker: m.lc_impact_group_blocker,
	stops: m.lc_impact_group_stops,
	warn: m.lc_impact_group_warn,
	unaffected: m.lc_impact_group_unaffected
};

const SEVERITY_LABELS: Record<DowngradeSeverity, () => string> = {
	blocker: m.lc_impact_severity_blocker,
	stops: m.lc_impact_severity_stops,
	warn: m.lc_impact_severity_warn,
	unaffected: m.lc_impact_severity_unaffected
};

export interface DowngradeGroup {
	severity: DowngradeSeverity;
	heading: string;
	findings: DowngradeFinding[];
}

export interface StoreStep {
	label: string;
	url: string;
}

function isSeverity(value: unknown): value is DowngradeSeverity {
	return typeof value === 'string' && (SEVERITY_ORDER as string[]).includes(value);
}

export function parseSeverity(raw: unknown): DowngradeSeverity {
	return isSeverity(raw) ? raw : 'warn';
}

export function parseDowngradePreview(raw: unknown): DowngradePreview {
	const src = (raw ?? {}) as Partial<DowngradePreview> & Record<string, unknown>;
	const findings = Array.isArray(src.findings) ? src.findings : [];
	const parsed: DowngradeFinding[] = findings.map((f) => {
		const row = (f ?? {}) as Partial<DowngradeFinding>;
		return {
			capability: typeof row.capability === 'string' ? row.capability : 'unknown',
			severity: parseSeverity(row.severity),
			title: typeof row.title === 'string' ? row.title : '',
			summary: typeof row.summary === 'string' ? row.summary : '',
			domains: Array.isArray(row.domains) ? row.domains : undefined,
			mailboxes: Array.isArray(row.mailboxes) ? row.mailboxes : undefined
		};
	});
	return {
		...(src as DowngradePreview),
		eligible: src.eligible === true,
		blocked:
			typeof src.blocked === 'boolean'
				? src.blocked
				: parsed.some((f) => f.severity === 'blocker'),
		findings: parsed
	};
}

export function sortImpact(findings: DowngradeFinding[]): DowngradeFinding[] {
	return findings
		.map((f, i) => ({ f, i }))
		.sort((a, b) => {
			const rank = SEVERITY_ORDER.indexOf(a.f.severity) - SEVERITY_ORDER.indexOf(b.f.severity);
			return rank !== 0 ? rank : a.i - b.i;
		})
		.map(({ f }) => f);
}

export function groupsOf(preview: DowngradePreview): DowngradeGroup[] {
	const out: DowngradeGroup[] = [];
	for (const severity of SEVERITY_ORDER) {
		const findings = preview.findings.filter((f) => f.severity === severity);
		if (findings.length === 0) continue;
		out.push({ severity, heading: groupHeading(severity, findings.length), findings });
	}
	return out;
}

export function groupHeading(severity: DowngradeSeverity, count: number): string {
	if (severity === 'unaffected') return m.lc_impact_group_unaffected_count({ count });
	return GROUP_HEADINGS[severity]();
}

export function severityLabel(severity: DowngradeSeverity): string {
	return SEVERITY_LABELS[severity]();
}

export function canConfirm(preview: DowngradePreview | null): boolean {
	if (!preview) return false;
	return preview.eligible && !preview.blocked;
}

export function entryPointVisible(sub: Subscription | null | undefined): boolean {
	if (!sub) return false;
	if (sub.downgradeEligible !== true) return false;
	return sub.planCode !== 'free' && sub.planCode !== 'free_family';
}

export function targetPlanName(preview: DowngradePreview | null): string {
	if (!preview?.targetPlanCode) return m.lc_downgrade_target_default();
	return preview.targetPlanCode === 'free_family'
		? m.lc_plan_free_family_name()
		: m.lc_plan_free_name();
}

export function storeStep(sub: Subscription | null | undefined): StoreStep | null {
	const provider = sub?.provider;
	if (provider === 'apple') {
		return { label: 'App Store', url: 'https://apps.apple.com/account/subscriptions' };
	}
	if (provider === 'google_play') {
		const sku = sub?.planCode ?? '';
		const base = 'https://play.google.com/store/account/subscriptions';
		return {
			label: 'Google Play',
			url: sku ? `${base}?sku=${encodeURIComponent(sku)}&package=com.thelemail.mail` : base
		};
	}
	return null;
}

export function storeCancelRequired(preview: DowngradePreview | null): boolean {
	if (!preview) return false;
	if (typeof preview.storeCancellationRequired === 'boolean') {
		return preview.storeCancellationRequired;
	}
	return preview.provider === 'apple' || preview.provider === 'google_play';
}

export function scheduledLine(sub: Subscription | null | undefined): string | null {
	if (!sub?.pendingPlanCode) return null;
	const plan =
		sub.pendingPlanCode === 'free_family' ? m.lc_plan_free_family_name() : m.lc_plan_free_name();
	const date = formatDay(sub.pendingPlanEffectiveAt);
	return date
		? m.lc_downgrade_scheduled_on({ plan, date })
		: m.lc_downgrade_scheduled_period_end({ plan });
}

export function formatDay(iso: string | undefined | null): string | null {
	if (!iso) return null;
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return null;
	return at.toLocaleDateString(i18n.tag, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatBytes(bytes: number | undefined): string {
	if (typeof bytes !== 'number' || bytes < 0) return '';
	const gb = 1024 ** 3;
	const mb = 1024 ** 2;
	if (bytes >= gb) return m.lc_bytes_gb({ value: trim(bytes / gb) });
	if (bytes >= mb) return m.lc_bytes_mb({ value: trim(bytes / mb) });
	if (bytes >= 1024) return m.lc_bytes_kb({ value: trim(bytes / 1024) });
	return m.lc_bytes_bytes({ count: bytes });
}

function trim(value: number): string {
	return value.toFixed(1).replace(/\.0$/, '');
}

export function ineligibleMessage(
	preview: DowngradePreview | null,
	workspaceName: string
): string | null {
	if (!preview || preview.eligible) return null;
	switch (preview.ineligibleReason) {
		case 'not_owner':
			return m.lc_downgrade_ineligible_not_owner({ workspace: workspaceName });
		case 'already_free':
			return m.lc_downgrade_ineligible_already_free();
		case 'no_free_tier':
			return m.lc_downgrade_ineligible_no_free_tier();
		case 'no_subscription':
			return m.lc_downgrade_ineligible_no_subscription();
		default:
			return m.lc_downgrade_ineligible_default();
	}
}
