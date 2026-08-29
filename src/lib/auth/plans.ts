export type ProductId = 'personal' | 'family' | 'business';

export interface PlanTier {
	id: string;
	name: string;
	price: number;
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
}

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
				price: 24,
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
				price: 48,
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
		tagline: 'Everything your household needs, one yearly price.',
		bothLine: 'Both include everything in Personal. One flat price for the whole household — never per seat.',
		tiers: [
			{
				id: 'family',
				name: 'Family',
				price: 60,
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
				price: 96,
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
			'Both include everything in Personal. Billed per mailbox, prorated when adding or removing people mid-year.',
		perMailbox: true,
		tiers: [
			{
				id: 'team',
				name: 'Team',
				price: 54,
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
				price: 84,
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

export function selectionForCode(planCode: string, seats: number): PlanSelection | null {
	const tierId = planCode.replace(/_/g, '-');
	for (const product of PRODUCTS) {
		if (product.tiers.some((t) => t.id === tierId)) {
			return { product: product.id, tier: tierId, seats };
		}
	}
	return null;
}

export function planLabelFor(planCode: string, seats: number): string {
	const sel = selectionForCode(planCode, seats);
	if (!sel) return planCode.replace(/_/g, ' ');
	const { tier } = findPlan(sel);
	if (!tier) return planCode.replace(/_/g, ' ');
	return `${tier.name} · ${eur(planTotal(sel))} / year`;
}

export function planTotal(sel: PlanSelection): number {
	const { product, tier } = findPlan(sel);
	if (!tier) return 0;
	return product.perMailbox ? tier.price * sel.seats : tier.price;
}

export function eur(n: number): string {
	return `€${n}`;
}
