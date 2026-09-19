<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Globe from '@lucide/svelte/icons/globe';
	import HardDrive from '@lucide/svelte/icons/hard-drive';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { page } from '$app/state';
	import { billing } from '$core/stores/billing.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import Rich from '$core/i18n/Rich.svelte';

	const STORAGE_WARN_RATIO = 0.9;

	const slot = $derived(page.params.slot ?? '0');
	const settingsBase = $derived(`/u/${slot}/settings`);

	const paymentOverdue = $derived(billing.subscription?.status === 'past_due');

	const failedDomains = $derived(customDomains.items.filter((d) => d.status === 'failed'));

	const storageUsed = $derived(billing.subscription?.storageBytesUsed ?? 0);
	const storageLimit = $derived(billing.subscription?.storageBytesLimit ?? 0);
	const storageAlmostFull = $derived(
		storageLimit > 0 && storageUsed / storageLimit >= STORAGE_WARN_RATIO
	);

	const anyAlert = $derived(
		paymentOverdue || failedDomains.length > 0 || storageAlmostFull
	);

	function gb(bytes: number, decimals = 1): string {
		return (bytes / 2 ** 30).toFixed(decimals).replace(/\.0$/, '');
	}
</script>

{#if anyAlert}
	<div class="sysalerts" role="status" aria-label={m.mail_alerts_aria()}>
		{#if paymentOverdue}
			<div class="sysalert sa-danger">
				<span class="sa-ic"><CreditCard size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">{m.mail_alerts_payment_title()}</span>
					<span class="sa-d">
						{m.mail_alerts_payment_detail()}
					</span>
				</span>
				<a class="sa-act" href={`${settingsBase}/account`}>{m.mail_alerts_payment_action()}<ArrowRight size={13} /></a>
			</div>
		{/if}
		{#if failedDomains.length > 0}
			<div class="sysalert sa-warning">
				<span class="sa-ic"><Globe size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">{m.mail_alerts_dns_title()}</span>
					<span class="sa-d">
						<Rich
							text={failedDomains.length > 1
								? m.mail_alerts_dns_detail_more({
										domain: failedDomains[0].domain,
										count: failedDomains.length - 1
									})
								: m.mail_alerts_dns_detail_one({ domain: failedDomains[0].domain })}
							tags={{ mono }}
						/>
					</span>
				</span>
				<a class="sa-act" href={`${settingsBase}/domains/${failedDomains[0].id}`}>
					{m.mail_alerts_dns_action()}<ArrowRight size={13} />
				</a>
			</div>
		{/if}
		{#if storageAlmostFull}
			<div class="sysalert sa-warning">
				<span class="sa-ic"><HardDrive size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">{m.mail_alerts_storage_title()}</span>
					<span class="sa-d">
						<Rich
							text={m.mail_alerts_storage_detail({ used: gb(storageUsed), limit: gb(storageLimit, 0) })}
							tags={{ mono }}
						/>
					</span>
				</span>
				{#if billing.isFree}
					<a class="sa-act solid" href={`/u/${slot}/billing/choose`}>{m.mail_alerts_storage_upgrade()}<ArrowRight size={13} /></a>
				{:else}
					<a class="sa-act" href={`${settingsBase}/account`}>{m.mail_alerts_storage_manage()}<ArrowRight size={13} /></a>
				{/if}
			</div>
		{/if}
	</div>
{/if}

{#snippet mono(t: string)}<span class="mono">{t}</span>{/snippet}
