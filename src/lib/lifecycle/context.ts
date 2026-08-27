import type { Subscription } from '$lib/api/billing';
import type { LifecycleInfo } from '$lib/api/types';
import { daysBetween, ladderFor } from './dates';
import type { LifecycleContext, LifecycleStage, LifecyclePlan } from './types';

const DEFAULT_EMAIL = 'you@thelemail.com';
const DEFAULT_DOMAIN = 'thelemail.com';
const DEFAULT_MAILBOX_GB = 15;

export function deriveStage(info: LifecycleInfo | null): LifecycleStage {
	if (!info) return 'active';
	switch (info.stage) {
		case 'grace':
			return info.expiryScreenShown ? 'grace' : 'expired';
		case 'suspended':
		case 'pending_deletion':
			return 'suspended';
		default:
			return 'active';
	}
}

export interface ServerContextInput {
	info: LifecycleInfo | null;
	sub: Subscription | null;
	email: string;
	restoreOrigin: LifecycleStage | null;
}

export function buildContextFromServer(input: ServerContextInput): LifecycleContext {
	const now = new Date();
	const email = input.email;
	const domain = email.includes('@') ? email.slice(email.indexOf('@') + 1) : DEFAULT_DOMAIN;
	const info = input.info;
	const trialing = !info && input.sub?.status === 'trialing' && input.sub.trialEnd;
	const day0 = info ? new Date(info.day0) : now;
	const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
	let dates: { trialEnd: Date; suspend: Date; remove: Date };
	if (trialing && input.sub?.trialEnd) {
		const trialEnd = new Date(input.sub.trialEnd);
		dates = { trialEnd, suspend: addDays(trialEnd, 30), remove: addDays(trialEnd, 90) };
	} else {
		dates = {
			trialEnd: day0,
			suspend: info ? new Date(info.suspendAt) : day0,
			remove: info ? new Date(info.deletionDate) : day0
		};
	}
	return {
		email,
		domain,
		cohort: info?.cohort ?? (trialing ? 'trial' : null),
		plan: planFrom(input.sub),
		dates,
		ladder: ladderFor(now, dates),
		now,
		graceDays: Math.max(0, daysBetween(dates.suspend, dates.trialEnd)),
		retentionDays: Math.max(0, daysBetween(dates.remove, dates.trialEnd)),
		urgency: daysBetween(dates.trialEnd, now) <= 3 ? 't3' : 't7',
		cameFromSuspended: input.restoreOrigin === 'suspended' || Boolean(info?.welcomeBack?.bounceFrom)
	};
}

export function planFrom(sub: Subscription | null): LifecyclePlan {
	const used = sub?.storageBytesUsed ?? 0;
	const gb = used > 0 ? Math.round(used / 2 ** 30) : DEFAULT_MAILBOX_GB;
	return {
		code: sub?.planCode ?? null,
		name: sub?.planCode ? sub.planCode.replace(/_/g, ' ') : 'Personal',
		mailboxGB: gb
	};
}

export const contextDefaults = {
	email: DEFAULT_EMAIL,
	domain: DEFAULT_DOMAIN,
	mailboxGB: DEFAULT_MAILBOX_GB
};
