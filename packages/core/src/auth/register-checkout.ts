import type { BillingInterval, PlanCode } from '$core/api/billing';
import type { ProductId } from './plans';

export interface RegisterCheckout {
	planCode: PlanCode;
	interval: BillingInterval;
	seats: number | undefined;
	workspaceType: ProductId;
}
