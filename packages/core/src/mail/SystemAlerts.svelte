<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import {
		faArrowRight,
		faCreditCard,
		faGlobe,
		faHardDrive
	} from '@fortawesome/pro-regular-svg-icons';
	import { page } from '$app/state';
	import { billing } from '$core/stores/billing.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import Rich from '$core/i18n/Rich.svelte';
	import { formatMoment } from '$core/i18n/relative';
	import { canManageWorkspace } from '$core/settings/permissions';
	import { isDormant, ownershipLapsing, resumeStep } from '$core/settings/domains/steps';

	const STORAGE_WARN_RATIO = 0.9;

	const slot = $derived(page.params.slot ?? '0');
	const settingsBase = $derived(`/u/${slot}/settings`);

	const paymentOverdue = $derived(billing.subscription?.status === 'past_due');

	const manage = $derived(canManageWorkspace());

	const lapsing = $derived(customDomains.items.filter((d) => ownershipLapsing(d) && !!d.releaseAt));

	const failedDomains = $derived(
		customDomains.items.filter((d) => d.status === 'failed' && !isDormant(d) && !ownershipLapsing(d))
	);

	const storageUsed = $derived(billing.subscription?.storageBytesUsed ?? 0);
	const storageLimit = $derived(billing.subscription?.storageBytesLimit ?? 0);
	const storageAlmostFull = $derived(
		storageLimit > 0 && storageUsed / storageLimit >= STORAGE_WARN_RATIO
	);

	const anyAlert = $derived(
		paymentOverdue || lapsing.length > 0 || failedDomains.length > 0 || storageAlmostFull
	);

	function gb(bytes: number, decimals = 1): string {
		return (bytes / 2 ** 30).toFixed(decimals).replace(/\.0$/, '');
	}
</script>

{#if anyAlert}
	<div class="sysalerts" role="status" aria-label={m.mail_alerts_aria()}>
		{#if paymentOverdue}
			<div class="sysalert sa-danger">
				<span class="sa-ic"><Icon icon={faCreditCard} size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">{m.mail_alerts_payment_title()}</span>
					<span class="sa-d">
						{m.mail_alerts_payment_detail()}
					</span>
				</span>
				<Button variant="neutral" size="sm" class="sa-act" href={`${settingsBase}/account`}>{m.mail_alerts_payment_action()}<Icon icon={faArrowRight} size={13} /></Button>
			</div>
		{/if}
		{#each lapsing as d (d.id)}
			{@const args = { domain: d.domain, deadline: formatMoment(d.releaseAt ?? '') }}
			<div class="sysalert sa-danger">
				<span class="sa-ic"><Icon icon={faGlobe} size={15} /></span>
				<span class="sa-tx">
					<span class="sa-h">{m.mail_alerts_domain_lapse_title()}</span>
					<span class="sa-d">
						<Rich
							text={manage
								? m.mail_alerts_domain_lapse_detail(args)
								: m.mail_alerts_domain_lapse_detail_member(args)}
							tags={{ mono }}
						/>
					</span>
				</span>
				{#if manage}
					<Button variant="neutral" size="sm" class="sa-act" href={`${settingsBase}/domains/${d.id}?step=ownership`}>
						{m.mail_alerts_domain_lapse_action()}<Icon icon={faArrowRight} size={13} />
					</Button>
				{/if}
			</div>
		{/each}
		{#if failedDomains.length > 0}
			<div class="sysalert sa-warning">
				<span class="sa-ic"><Icon icon={faGlobe} size={15} /></span>
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
				<Button variant="neutral" size="sm" class="sa-act" href={`${settingsBase}/domains/${failedDomains[0].id}?step=${resumeStep(failedDomains[0])}`}>
					{m.mail_alerts_dns_action()}<Icon icon={faArrowRight} size={13} />
				</Button>
			</div>
		{/if}
		{#if storageAlmostFull}
			<div class="sysalert sa-warning">
				<span class="sa-ic"><Icon icon={faHardDrive} size={15} /></span>
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
					<Button variant="primary" size="sm" class="sa-act" href={`/u/${slot}/billing/choose`}>{m.mail_alerts_storage_upgrade()}<Icon icon={faArrowRight} size={13} /></Button>
				{:else}
					<Button variant="neutral" size="sm" class="sa-act" href={`${settingsBase}/account`}>{m.mail_alerts_storage_manage()}<Icon icon={faArrowRight} size={13} /></Button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

{#snippet mono(t: string)}<span class="mono">{t}</span>{/snippet}
