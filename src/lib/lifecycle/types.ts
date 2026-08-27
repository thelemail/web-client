import type { PlanCode } from '$lib/api/billing';
import type { LifecycleCohort } from '$lib/api/types';

export type LifecycleStage = 'active' | 'trial-ending' | 'expired' | 'grace' | 'suspended';

export type TrialUrgency = 't7' | 't3';

export type ExportJobState = 'idle' | 'running' | 'ready';

export type RetentionOffer = 'pause' | 'cheaper';

export interface LadderPosition {
	day: number;
	toSuspend: number;
	toDelete: number;
}

export interface LifecycleDates {
	trialEnd: Date;
	suspend: Date;
	remove: Date;
}

export interface LifecyclePlan {
	code: PlanCode | null;
	name: string;
	mailboxGB: number;
}

export interface LifecycleContext {
	email: string;
	domain: string;
	cohort: LifecycleCohort | null;
	plan: LifecyclePlan;
	dates: LifecycleDates;
	ladder: LadderPosition;
	now: Date;
	graceDays: number;
	retentionDays: number;
	urgency: TrialUrgency;
	cameFromSuspended: boolean;
}

export interface ReactivationPlan {
	id: PlanCode;
	name: string;
	gb: number;
	price: number;
	icon: string;
	framing: string;
	badge?: string;
	rows: [string, string][];
}

export interface ExportScope {
	id: string;
	nm: string;
	meta: string;
}

export interface ExportPart {
	nm: string;
	sz: string;
	kind: string;
}
