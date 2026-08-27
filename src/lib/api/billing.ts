import { apiFetch } from './client';
import type { WorkspaceType } from './workspaces';

export type PlanCode =
	| 'personal'
	| 'personal_plus'
	| 'family'
	| 'family_plus'
	| 'team'
	| 'business';

export type PricingModel = 'flat' | 'per_mailbox';

export type SubscriptionStatus =
	| 'none'
	| 'incomplete'
	| 'trialing'
	| 'active'
	| 'past_due'
	| 'canceled';

export interface Plan {
	code: PlanCode;
	workspaceType: WorkspaceType;
	displayName: string;
	pricingModel: PricingModel;
	currency: string;
	yearlyAmountCents: number;
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

export interface Subscription {
	status: SubscriptionStatus;
	entitled: boolean;
	planCode?: PlanCode;
	seats?: number;
	currentPeriodEnd?: string;
	cancelAtPeriodEnd: boolean;
	storageBytesUsed?: number;
	storageBytesLimit?: number;
	trialEnd?: string;
}

export interface CreateCheckoutSessionInput {
	planCode: PlanCode;
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

export function changePlan(input: { planCode: PlanCode; seats?: number }): Promise<Subscription> {
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
