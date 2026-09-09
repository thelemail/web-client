import type { PlanCode } from '$lib/api/billing';

export type LifecycleStage = 'active' | 'expired' | 'grace' | 'suspended';

export type ExportJobState = 'idle' | 'running' | 'ready';

export type RetentionOffer = 'pause' | 'cheaper';

export interface LadderPosition {
	day: number;
	toSuspend: number;
	toDelete: number;
}

export interface LifecycleDates {
	end: Date;
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
	plan: LifecyclePlan;
	dates: LifecycleDates;
	ladder: LadderPosition;
	now: Date;
	graceDays: number;
	retentionDays: number;
	cameFromSuspended: boolean;
}

export interface ReactivationPlan {
	id: PlanCode;
	name: string;
	gb: number;
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
