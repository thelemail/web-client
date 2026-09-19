import { m } from '$paraglide/messages.js';

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
			[m.auth_plan_row_address(), 'yours@thelemail.com'],
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
			[m.auth_plan_row_addresses(), 'yours@thelemail.com'],
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

export function planLabelFor(planCode: string, seats: number, period: BillingPeriod = 'year'): string {
	const sel = selectionForCode(planCode, seats, period);
	if (!sel) return planCode.replace(/_/g, ' ');
	const { tier } = findPlan(sel);
	if (!tier) return planCode.replace(/_/g, ' ');
	return m.auth_plan_label({ plan: tier.name, price: pricePerPeriod(planTotal(sel), period) });
}

export function pricePerPeriod(amount: number, period: BillingPeriod): string {
	return period === 'month'
		? m.auth_price_per_month({ price: eur(amount) })
		: m.auth_price_per_year({ price: eur(amount) });
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
