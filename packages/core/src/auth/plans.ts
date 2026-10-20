import { m } from '$paraglide/messages.js';
import { platformDomains } from '$core/stores/platformDomains.svelte';
import { i18n } from '$core/i18n/locale.svelte';
import type { Plan, Subscription } from '$core/api/billing';

export type ProductId = 'personal' | 'family' | 'business';

export type BillingPeriod = 'year' | 'month';

export interface PlanPrices {
	year: number;
	month: number;
}

export interface PlanTier {
	id: string;
	name: string;
	prices: PlanPrices;
	badge?: string;
	framing?: string;
	rows: [string, string][];
}

export interface PlanProduct {
	id: ProductId;
	name: string;
	badge?: string;
	tagline: string;
	bothLine: string;
	perMailbox?: boolean;
	tiers: PlanTier[];
}

export interface PlanSelection {
	product: ProductId;
	tier: string | null;
	seats: number;
	period: BillingPeriod;
}

export const FREE_PLAN = {
	id: 'free',
	get name() {
		return m.auth_plan_free_name();
	},
	get rows(): [string, string][] {
		return [
			[m.auth_plan_row_mailboxes(), '1'],
			[m.auth_plan_row_storage(), m.auth_plan_value_gb({ size: 1 })],
			[m.auth_plan_row_address(), `yours@${platformDomains.default}`],
			[m.auth_plan_row_custom_domains(), m.auth_plan_value_none()]
		];
	}
};

export const FREE_FAMILY_PLAN = {
	id: 'free_family',
	get name() {
		return m.auth_plan_free_family_name();
	},
	get rows(): [string, string][] {
		return [
			[m.auth_plan_row_mailboxes(), m.auth_plan_value_up_to({ count: 6 })],
			[m.auth_plan_row_storage_per_mailbox(), m.auth_plan_value_gb({ size: 1 })],
			[m.auth_plan_row_addresses(), `yours@${platformDomains.default}`],
			[m.auth_plan_row_custom_domains(), m.auth_plan_value_none()]
		];
	}
};

export const MIN_SEATS = 3;
export const MAX_SEATS = 50;

export const PRODUCTS: PlanProduct[] = [
	{
		id: 'personal',
		get name() {
			return m.auth_plan_personal_name();
		},
		get tagline() {
			return m.auth_plan_personal_tagline();
		},
		get bothLine() {
			return m.auth_plan_personal_both();
		},
		tiers: [
			{
				id: 'personal',
				get name() {
					return m.auth_plan_personal_name();
				},
				prices: { year: 24, month: 3 },
				get rows(): [string, string][] {
					return [
						[m.auth_plan_row_mailboxes(), '1'],
						[m.auth_plan_row_storage(), m.auth_plan_value_gb({ size: 15 })],
						[m.auth_plan_row_custom_domains(), '1'],
						[m.auth_plan_row_domain_addresses(), m.auth_plan_value_unlimited()]
					];
				}
			},
			{
				id: 'personal-plus',
				get name() {
					return m.auth_plan_personal_plus_name();
				},
				prices: { year: 48, month: 5 },
				get framing() {
					return m.auth_plan_personal_plus_framing();
				},
				get rows(): [string, string][] {
					return [
						[m.auth_plan_row_mailboxes(), '1'],
						[m.auth_plan_row_storage(), m.auth_plan_value_gb({ size: 50 })],
						[m.auth_plan_row_custom_domains(), '3'],
						[m.auth_plan_row_domain_addresses(), m.auth_plan_value_unlimited()]
					];
				}
			}
		]
	},
	{
		id: 'family',
		get name() {
			return m.auth_plan_family_name();
		},
		get badge() {
			return m.auth_plan_badge_most_chosen();
		},
		get tagline() {
			return m.auth_plan_family_tagline();
		},
		get bothLine() {
			return m.auth_plan_family_both();
		},
		tiers: [
			{
				id: 'family',
				get name() {
					return m.auth_plan_family_name();
				},
				prices: { year: 60, month: 6.5 },
				get badge() {
					return m.auth_plan_badge_most_chosen();
				},
				get rows(): [string, string][] {
					return [
						[m.auth_plan_row_mailboxes(), m.auth_plan_value_up_to({ count: 6 })],
						[m.auth_plan_row_storage_per_mailbox(), m.auth_plan_value_gb({ size: 10 })],
						[m.auth_plan_row_custom_domains(), '2'],
						[m.auth_plan_row_domain_addresses(), m.auth_plan_value_unlimited()]
					];
				}
			},
			{
				id: 'family-plus',
				get name() {
					return m.auth_plan_family_plus_name();
				},
				prices: { year: 96, month: 10 },
				get framing() {
					return m.auth_plan_family_plus_framing();
				},
				get rows(): [string, string][] {
					return [
						[m.auth_plan_row_mailboxes(), m.auth_plan_value_up_to({ count: 6 })],
						[m.auth_plan_row_storage_per_mailbox(), m.auth_plan_value_gb({ size: 30 })],
						[m.auth_plan_row_custom_domains(), '4'],
						[m.auth_plan_row_domain_addresses(), m.auth_plan_value_unlimited()]
					];
				}
			}
		]
	},
	{
		id: 'business',
		get name() {
			return m.auth_plan_business_name();
		},
		get tagline() {
			return m.auth_plan_business_tagline();
		},
		get bothLine() {
			return m.auth_plan_business_both();
		},
		perMailbox: true,
		tiers: [
			{
				id: 'team',
				get name() {
					return m.auth_plan_team_name();
				},
				prices: { year: 54, month: 6 },
				get rows(): [string, string][] {
					return [
						[m.auth_plan_row_storage_per_mailbox(), m.auth_plan_value_gb({ size: 25 })],
						[m.auth_plan_row_custom_domains(), m.auth_plan_value_up_to({ count: 5 })],
						[m.auth_plan_row_domain_addresses(), m.auth_plan_value_unlimited()],
						[m.auth_plan_row_roles(), m.auth_plan_value_included()],
						[m.auth_plan_row_audit_logs(), m.auth_plan_value_retention_days({ days: 90 })],
						[m.auth_plan_row_priority_support(), m.auth_plan_value_included()]
					];
				}
			},
			{
				id: 'business',
				get name() {
					return m.auth_plan_business_name();
				},
				prices: { year: 84, month: 9 },
				get framing() {
					return m.auth_plan_business_framing();
				},
				get rows(): [string, string][] {
					return [
						[m.auth_plan_row_storage_per_mailbox(), m.auth_plan_value_gb({ size: 100 })],
						[m.auth_plan_row_custom_domains(), m.auth_plan_value_up_to({ count: 10 })],
						[m.auth_plan_row_domain_addresses(), m.auth_plan_value_unlimited()],
						[m.auth_plan_row_roles(), m.auth_plan_value_included()],
						[m.auth_plan_row_audit_logs(), m.auth_plan_value_retention_one_year()],
						[m.auth_plan_row_priority_support(), m.auth_plan_value_same_business_day()]
					];
				}
			}
		]
	}
];

export function findPlan(sel: PlanSelection): { product: PlanProduct; tier: PlanTier | null } {
	const product = PRODUCTS.find((p) => p.id === sel.product) ?? PRODUCTS[0];
	const tier = product.tiers.find((t) => t.id === sel.tier) ?? null;
	return { product, tier };
}

export function selectionForCode(
	planCode: string,
	seats: number,
	period: BillingPeriod = 'year'
): PlanSelection | null {
	const tierId = planCode.replace(/_/g, '-');
	for (const product of PRODUCTS) {
		if (product.tiers.some((t) => t.id === tierId)) {
			return { product: product.id, tier: tierId, seats, period };
		}
	}
	return null;
}

export function pricePerPeriod(amount: number, period: BillingPeriod): string {
	return perPeriod(eur(amount), period);
}

function perPeriod(price: string, period: BillingPeriod): string {
	return period === 'month'
		? m.auth_price_per_month({ price })
		: m.auth_price_per_year({ price });
}

export function money(cents: number, currency: string): string {
	return new Intl.NumberFormat(i18n.tag, {
		style: 'currency',
		currency: currency.toUpperCase(),
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2
	}).format(cents / 100);
}

export interface SubscriptionPrice {
	unit: string;
	total: string;
	seats: number;
	period: BillingPeriod;
	perMailbox: boolean;
}

export function subscriptionPrice(
	plan: Plan | null | undefined,
	sub: Subscription | null | undefined
): SubscriptionPrice | null {
	if (!plan || !sub?.interval || plan.code !== sub.planCode) return null;
	if (sub.provider === 'apple' || sub.provider === 'google_play') return null;
	const period = sub.interval;
	const cents = period === 'month' ? plan.monthlyAmountCents : plan.yearlyAmountCents;
	const perMailbox = plan.pricingModel === 'per_mailbox';
	const seats = perMailbox ? (sub.seats ?? plan.minSeats) : 1;
	return {
		unit: money(cents, plan.currency),
		total: money(cents * seats, plan.currency),
		seats,
		period,
		perMailbox
	};
}

export function planNameFor(planCode: string, plan?: Plan | null): string {
	const sel = selectionForCode(planCode, 1, 'year');
	const tier = sel ? findPlan(sel).tier : null;
	return tier?.name ?? plan?.displayName ?? planCode.replace(/_/g, ' ');
}

export function subscriptionPlanLabel(
	plan: Plan | null | undefined,
	sub: Subscription | null | undefined
): string | null {
	if (!sub?.planCode) return null;
	const name = planNameFor(sub.planCode, plan);
	const price = subscriptionPrice(plan, sub);
	if (!price) return name;
	return m.auth_plan_label({ plan: name, price: perPeriod(price.total, price.period) });
}

export function planTotal(sel: PlanSelection): number {
	const { product, tier } = findPlan(sel);
	if (!tier) return 0;
	const price = tier.prices[sel.period];
	return product.perMailbox ? price * sel.seats : price;
}

export function monthlyEquivalent(sel: PlanSelection): number {
	const { product, tier } = findPlan(sel);
	if (!tier) return 0;
	const price = tier.prices.year / 12;
	return product.perMailbox ? price * sel.seats : price;
}

export function annualSavingPercent(tier: PlanTier): number {
	if (!tier.prices.month) return 0;
	return Math.round((1 - tier.prices.year / (tier.prices.month * 12)) * 100);
}

export function eur(n: number): string {
	const rounded = Math.round(n * 100) / 100;
	return `€${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
}

export function periodFromQuery(raw: string | null | undefined): BillingPeriod {
	const value = raw?.trim().toLowerCase();
	return value === 'monthly' || value === 'month' ? 'month' : 'year';
}

export function planFromQuery(
	raw: string | null | undefined,
	period: BillingPeriod = 'year'
): PlanSelection | null {
	if (!raw) return null;
	const tierId = raw.trim().toLowerCase().replace(/_/g, '-');
	if (!tierId) return null;
	return selectionForCode(tierId, MIN_SEATS, period);
}
