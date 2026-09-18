import { apiFetch } from './client';
import type { WorkspaceType } from './workspaces';

export type PlanCode =
	| 'free'
	| 'free_family'
	| 'personal'
	| 'personal_plus'
	| 'family'
	| 'family_plus'
	| 'team'
	| 'business';

export type PricingModel = 'flat' | 'per_mailbox';

export type BillingInterval = 'month' | 'year';

export type SubscriptionStatus = 'none' | 'active' | 'past_due' | 'canceled';

export interface Plan {
	code: PlanCode;
	workspaceType: WorkspaceType;
	displayName: string;
	pricingModel: PricingModel;
	currency: string;
	yearlyAmountCents: number;
	monthlyAmountCents: number;
	minSeats: number;
	maxSeats?: number;
	storageBytesPerMailbox: number;
	customDomainsLimit: number;
	auditRetentionDays: number;
	prioritySupport: 'none' | 'priority' | 'same_business_day';
}

export interface PlanCatalog {
	plans: Plan[];
}

export type BillingProvider = 'stripe' | 'google_play' | 'apple';

export interface Subscription {
	status: SubscriptionStatus;
	entitled: boolean;
	planCode?: PlanCode;
	interval?: BillingInterval;
	seats?: number;
	currentPeriodEnd?: string;
	cancelAtPeriodEnd: boolean;
	storageBytesUsed?: number;
	storageBytesLimit?: number;
	provider?: BillingProvider;
	downgradeEligible?: boolean;
	pendingPlanCode?: PlanCode;
	pendingPlanEffectiveAt?: string;
}

export type DowngradeSeverity = 'unaffected' | 'warn' | 'stops' | 'blocker';

export type DowngradeIneligibleReason =
	| 'no_free_tier'
	| 'already_free'
	| 'not_owner'
	| 'no_subscription';

export interface DowngradeDomain {
	customDomainId?: string;
	domain: string;
	addressCount: number;
	addresses?: string[];
}

export interface DowngradeMailbox {
	accountId?: string;
	email: string;
	fullName?: string;
	bytesUsed: number;
	bytesOver: number;
}

export interface DowngradeFinding {
	capability: string;
	severity: DowngradeSeverity;
	title: string;
	summary: string;
	domains?: DowngradeDomain[];
	mailboxes?: DowngradeMailbox[];
}

export interface DowngradePreview {
	eligible: boolean;
	ineligibleReason?: DowngradeIneligibleReason;
	blocked: boolean;
	currentPlanCode: PlanCode;
	targetPlanCode?: PlanCode;
	provider?: BillingProvider;
	storeCancellationRequired?: boolean;
	effectiveAt?: string;
	storageBytesPerMailbox?: number;
	seatLimit?: number;
	overQuotaGraceDays?: number;
	findings: DowngradeFinding[];
}

export interface CreateCheckoutSessionInput {
	planCode: PlanCode;
	interval?: BillingInterval;
	seats?: number;
	successUrl: string;
	cancelUrl: string;
}

export function getPlans(): Promise<PlanCatalog> {
	return apiFetch('/v1/billing/plans', { skipAuth: true });
}

export function getMySubscription(): Promise<Subscription> {
	return apiFetch('/v1/billing/subscription');
}

export function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ url: string }> {
	return apiFetch('/v1/billing/checkout-session', { method: 'POST', body: input });
}

export function changePlan(input: {
	planCode: PlanCode;
	interval?: BillingInterval;
	seats?: number;
}): Promise<Subscription> {
	return apiFetch('/v1/billing/change-plan', { method: 'POST', body: input });
}

export function createBillingPortalSession(input: { returnUrl: string }): Promise<{ url: string }> {
	return apiFetch('/v1/billing/portal-session', { method: 'POST', body: input });
}

export function cancelSubscription(): Promise<Subscription> {
	return apiFetch('/v1/billing/cancel', { method: 'POST' });
}

export function resumeSubscription(): Promise<Subscription> {
	return apiFetch('/v1/billing/resume', { method: 'POST' });
}

export function getDowngradePreview(): Promise<DowngradePreview> {
	return apiFetch('/v1/billing/downgrade');
}

export function requestDowngrade(): Promise<Subscription> {
	return apiFetch('/v1/billing/downgrade', { method: 'POST' });
}

export function cancelDowngrade(): Promise<Subscription> {
	return apiFetch('/v1/billing/downgrade', { method: 'DELETE' });
}
