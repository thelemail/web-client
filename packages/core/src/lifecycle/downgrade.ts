import type {
	DowngradeFinding,
	DowngradePreview,
	DowngradeSeverity,
	Subscription
} from '../api/billing';

const SEVERITY_ORDER: DowngradeSeverity[] = ['blocker', 'stops', 'warn', 'unaffected'];

const GROUP_HEADINGS: Record<DowngradeSeverity, string> = {
	blocker: 'Sort this out first',
	stops: 'Stops working',
	warn: 'Worth knowing',
	unaffected: 'Stays the same'
};

const SEVERITY_LABELS: Record<DowngradeSeverity, string> = {
	blocker: 'Action needed',
	stops: 'Stops',
	warn: 'Changes',
	unaffected: 'Unaffected'
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
	if (severity === 'unaffected') return `${GROUP_HEADINGS.unaffected} (${count})`;
	return GROUP_HEADINGS[severity];
}

export function severityLabel(severity: DowngradeSeverity): string {
	return SEVERITY_LABELS[severity];
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
	if (!preview?.targetPlanCode) return 'the free plan';
	return preview.targetPlanCode === 'free_family' ? 'Free Family' : 'Free';
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
	const name = sub.pendingPlanCode === 'free_family' ? 'Free Family' : 'Free';
	const when = formatDay(sub.pendingPlanEffectiveAt);
	return when ? `Moving to ${name} on ${when}.` : `Moving to ${name} when this period ends.`;
}

export function formatDay(iso: string | undefined | null): string | null {
	if (!iso) return null;
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return null;
	return at.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatBytes(bytes: number | undefined): string {
	if (typeof bytes !== 'number' || bytes < 0) return '';
	const gb = 1024 ** 3;
	const mb = 1024 ** 2;
	if (bytes >= gb) return `${trim(bytes / gb)} GB`;
	if (bytes >= mb) return `${trim(bytes / mb)} MB`;
	if (bytes >= 1024) return `${trim(bytes / 1024)} KB`;
	return `${bytes} bytes`;
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
			return `Only the owner of ${workspaceName} can change its plan. Here is what would change for you.`;
		case 'already_free':
			return 'This workspace is already on the free plan.';
		case 'no_free_tier':
			return 'Business plans have no free tier to move to. Talk to us about the options.';
		case 'no_subscription':
			return 'This workspace has no plan to move from.';
		default:
			return 'This workspace cannot move to the free plan right now.';
	}
}
