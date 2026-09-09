<script lang="ts">
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Globe from '@lucide/svelte/icons/globe';
	import HardDrive from '@lucide/svelte/icons/hard-drive';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { page } from '$app/state';
	import { auth } from '$lib/stores/auth.svelte';
	import { billing } from '$lib/stores/billing.svelte';
	import { customDomains } from '$lib/stores/customDomains.svelte';

	const STORAGE_WARN_RATIO = 0.9;

	const slot = $derived(page.params.slot ?? '0');
	const settingsBase = $derived(`/u/${slot}/settings`);

	const recoveryMissing = $derived(auth.recoveryEnabled === false);

	const paymentOverdue = $derived(billing.subscription?.status === 'past_due');

	const failedDomains = $derived(customDomains.items.filter((d) => d.status === 'failed'));

	const storageUsed = $derived(billing.subscription?.storageBytesUsed ?? 0);
	const storageLimit = $derived(billing.subscription?.storageBytesLimit ?? 0);
	const storageAlmostFull = $derived(
		storageLimit > 0 && storageUsed / storageLimit >= STORAGE_WARN_RATIO
	);

	const anyAlert = $derived(
		recoveryMissing || paymentOverdue || failedDomains.length > 0 || storageAlmostFull
	);

	function gb(bytes: number, decimals = 1): string {
		return (bytes / 2 ** 30).toFixed(decimals).replace(/\.0$/, '');
	}
</script>

{#if anyAlert}
	<div class="sysalerts" role="status" aria-label="Account alerts">
		{#if recoveryMissing}
			<div class="sysalert sa-warning">
				<span class="sa-ic"><LifeBuoy size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">Set up account recovery.</span>
					<span class="sa-d">
						Without a recovery phrase, a forgotten password means your mail is lost for good.
					</span>
				</span>
				<a class="sa-act" href={`${settingsBase}/security?ceremony=recovery`}>
					Set up recovery<ArrowRight size={13} />
				</a>
			</div>
		{/if}
		{#if paymentOverdue}
			<div class="sysalert sa-danger">
				<span class="sa-ic"><CreditCard size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">Payment overdue.</span>
					<span class="sa-d">
						Your last payment didn't go through. Sending pauses when the grace period ends.
					</span>
				</span>
				<a class="sa-act" href={`${settingsBase}/account`}>Update payment<ArrowRight size={13} /></a>
			</div>
		{/if}
		{#if failedDomains.length > 0}
			<div class="sysalert sa-warning">
				<span class="sa-ic"><Globe size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">DNS check failing.</span>
					<span class="sa-d">
						Records for <span class="mono">{failedDomains[0].domain}</span>{failedDomains.length > 1
							? ` and ${failedDomains.length - 1} more domain${failedDomains.length > 2 ? 's' : ''}`
							: ''} no longer resolve. Mail may be rejected or marked as spam.
					</span>
				</span>
				<a class="sa-act" href={`${settingsBase}/domains/${failedDomains[0].id}`}>
					Verify DNS<ArrowRight size={13} />
				</a>
			</div>
		{/if}
		{#if storageAlmostFull}
			<div class="sysalert sa-warning">
				<span class="sa-ic"><HardDrive size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">Storage is almost full.</span>
					<span class="sa-d">
						You've used <span class="mono">{gb(storageUsed)}</span> of
						<span class="mono">{gb(storageLimit, 0)} GB</span>. Incoming mail bounces when the
						mailbox is full.
					</span>
				</span>
				{#if billing.isFree}
					<a class="sa-act solid" href={`/u/${slot}/billing/choose`}>Upgrade<ArrowRight size={13} /></a>
				{:else}
					<a class="sa-act" href={`${settingsBase}/account`}>Manage storage<ArrowRight size={13} /></a>
				{/if}
			</div>
		{/if}
	</div>
{/if}
