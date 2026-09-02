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
	name: 'Free',
	rows: [
		['Mailboxes', '1'],
		['Storage', '1 GB'],
		['Address', 'yours@thelemail.com'],
		['Custom domains', 'None']
	] as [string, string][]
};

export const MIN_SEATS = 3;
export const MAX_SEATS = 50;

export const PRODUCTS: PlanProduct[] = [
	{
		id: 'personal',
		name: 'Personal',
		tagline: 'A private, encrypted mailbox of your own.',
		bothLine:
			'Both include zero-access encryption at rest, end-to-end encryption between accounts, encryption to outsiders who publish a key, 2FA & device sessions, full data export, and EU data residency.',
		tiers: [
			{
				id: 'personal',
				name: 'Personal',
				prices: { year: 24, month: 3 },
				rows: [
					['Mailboxes', '1'],
					['Storage', '15 GB'],
					['Custom domains', '1'],
					['Addresses on your domain', 'Unlimited']
				]
			},
			{
				id: 'personal-plus',
				name: 'Personal Plus',
				prices: { year: 48, month: 5 },
				framing: 'For heavy archives and multiple identities.',
				rows: [
					['Mailboxes', '1'],
					['Storage', '50 GB'],
					['Custom domains', '3'],
					['Addresses on your domain', 'Unlimited']
				]
			}
		]
	},
	{
		id: 'family',
		name: 'Family',
		badge: 'Most chosen',
		tagline: 'Everything your household needs, one flat price.',
		bothLine: 'Both include everything in Personal. One flat price for the whole household — never per seat.',
		tiers: [
			{
				id: 'family',
				name: 'Family',
				prices: { year: 60, month: 6.5 },
				badge: 'Most chosen',
				rows: [
					['Mailboxes', 'Up to 6'],
					['Storage per mailbox', '10 GB'],
					['Custom domains', '2'],
					['Addresses on your domain', 'Unlimited']
				]
			},
			{
				id: 'family-plus',
				name: 'Family Plus',
				prices: { year: 96, month: 10 },
				framing: 'For households that keep everything.',
				rows: [
					['Mailboxes', 'Up to 6'],
					['Storage per mailbox', '30 GB'],
					['Custom domains', '4'],
					['Addresses on your domain', 'Unlimited']
				]
			}
		]
	},
	{
		id: 'business',
		name: 'Business',
		tagline: 'For studios, businesses, and small teams.',
		bothLine:
			'Both include everything in Personal. Billed per mailbox, prorated when adding or removing people mid-term.',
		perMailbox: true,
		tiers: [
			{
				id: 'team',
				name: 'Team',
				prices: { year: 54, month: 6 },
				rows: [
					['Storage per mailbox', '25 GB'],
					['Custom domains', 'Up to 5'],
					['Addresses on your domain', 'Unlimited'],
					['Roles & org settings', 'Included'],
					['Audit logs', '90-day retention'],
					['Priority support', 'Included']
				]
			},
			{
				id: 'business',
				name: 'Business',
				prices: { year: 84, month: 9 },
				framing: 'For firms with heavier storage and compliance needs.',
				rows: [
					['Storage per mailbox', '100 GB'],
					['Custom domains', 'Up to 10'],
					['Addresses on your domain', 'Unlimited'],
					['Roles & org settings', 'Included'],
					['Audit logs', '1-year retention'],
					['Priority support', 'Same business day']
				]
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
	return `${tier.name} · ${eur(planTotal(sel))} / ${period}`;
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
