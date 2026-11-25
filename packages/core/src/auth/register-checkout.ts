import { goto } from '$app/navigation';
import { platform } from '$platform';
import type { BillingInterval, PlanCode } from '$core/api/billing';
import { createCheckoutSession } from '$core/api/billing';
import { changeMyWorkspaceType } from '$core/api/workspaces';
import type { ProductId } from './plans';

export interface RegisterCheckout {
	planCode: PlanCode;
	interval: BillingInterval;
	seats: number | undefined;
	workspaceType: ProductId;
}

const PLAN_CODES: readonly PlanCode[] = ['personal', 'personal_plus', 'family', 'family_plus', 'team', 'business'];
const INTERVALS: readonly BillingInterval[] = ['month', 'year'];
const WORKSPACE_TYPES: readonly ProductId[] = ['personal', 'family', 'business'];

export function checkoutRoute(slot: number, order: RegisterCheckout): string {
	const q = new URLSearchParams({ plan: order.planCode, interval: order.interval, type: order.workspaceType });
	if (order.seats !== undefined) q.set('seats', String(order.seats));
	return `/u/${slot}/billing/start?${q.toString()}`;
}

export function orderFromQuery(q: Pick<URLSearchParams, 'get'>): RegisterCheckout | null {
	const planCode = q.get('plan') as PlanCode | null;
	const interval = q.get('interval') as BillingInterval | null;
	const workspaceType = q.get('type') as ProductId | null;
	const seatsRaw = q.get('seats');
	const seats = seatsRaw === null ? undefined : Number(seatsRaw);
	if (!planCode || !PLAN_CODES.includes(planCode)) return null;
	if (!interval || !INTERVALS.includes(interval)) return null;
	if (!workspaceType || !WORKSPACE_TYPES.includes(workspaceType)) return null;
	if (seats !== undefined && (!Number.isInteger(seats) || seats < 1 || seats > 1000)) return null;
	return { planCode, interval, seats, workspaceType };
}

export async function startCheckout(slot: number, order: RegisterCheckout): Promise<void> {
	try {
		if (order.workspaceType !== 'personal') {
			await changeMyWorkspaceType({ type: order.workspaceType });
		}
		const origin = platform.returnOrigin();
		const { url } = await createCheckoutSession({
			planCode: order.planCode,
			interval: order.interval,
			seats: order.seats,
			successUrl: `${origin}/u/${slot}/billing/return`,
			cancelUrl: `${origin}/u/${slot}/billing/choose?canceled=1`
		});
		platform.openExternal(url);
	} catch (err) {
		console.error('register: checkout session failed', err);
		await goto(`/u/${slot}/billing/choose`);
	}
}
