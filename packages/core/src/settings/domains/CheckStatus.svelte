<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faCircleCheck,
		faCircleExclamation,
		faCircleInfo,
		faClock
	} from '@fortawesome/pro-regular-svg-icons';

	import { reasonMessage, stageCheckState, type CheckStage } from './steps';
	import type { CustomDomain } from '$core/api/customDomains';
	import { formatMoment, timeSince, timeUntil } from '$core/i18n/relative';
	import { m } from '$paraglide/messages.js';

	interface Props {
		domain: CustomDomain;
		stage: CheckStage;
		now: number;
		manage: boolean;
		canStart: boolean;
	}

	let { domain, stage, now, manage, canStart }: Props = $props();

	const OK: Record<CheckStage, () => string> = {
		ownership: () => m.settings_domains_wizard_ownership_ok(),
		sending: () => m.settings_domains_wizard_sending_ok(),
		routing: () => m.settings_domains_wizard_routing_ok()
	};

	const RUNNING: Record<CheckStage, () => string> = {
		ownership: () => m.settings_domains_check_running_ownership(),
		sending: () => m.settings_domains_check_running_sending(),
		routing: () => m.settings_domains_check_running_routing()
	};

	const checkState = $derived(stageCheckState(domain, stage));
	const check = $derived(domain.check && domain.check.stage === stage ? domain.check : null);
	const actionable = $derived(domain.actionableStage === stage);
	const reason = $derived(reasonMessage(check?.result));
	const restart = $derived(
		canStart
			? m.settings_domains_check_expired_again()
			: !manage && actionable
				? m.settings_domains_check_expired_member()
				: ''
	);
</script>

{#if checkState === 'verified'}
	<div class="dw-note ok">
		<Icon icon={faCircleCheck} size={15} /><span>{OK[stage]()}</span>
	</div>
{:else if checkState === 'running' && check}
	<div class="dw-note">
		<Icon icon={faClock} size={15} />
		<span>
			<b>{RUNNING[stage]()}</b>
			{check.lastCheckedAt
				? m.settings_domains_check_last({ when: timeSince(check.lastCheckedAt, now) })
				: m.settings_domains_check_first()}
			{#if check.nextCheckAt}
				{m.settings_domains_check_next({ when: timeUntil(check.nextCheckAt, now) })}
			{/if}
			{m.settings_domains_check_until({ deadline: formatMoment(check.deadlineAt) })}
		</span>
	</div>
	{#if reason}
		<div class="dw-note warn"><Icon icon={faCircleExclamation} size={15} /><span>{reason}</span></div>
	{/if}
{:else if checkState === 'expired' && check}
	<div class="dw-note warn">
		<Icon icon={faCircleExclamation} size={15} />
		<span>
			{m.settings_domains_check_expired({ deadline: formatMoment(check.deadlineAt) })}
			{restart}
		</span>
	</div>
	{#if reason}
		<div class="dw-note warn"><Icon icon={faCircleExclamation} size={15} /><span>{reason}</span></div>
	{/if}
{:else if canStart}
	<div class="dw-note">
		<Icon icon={faCircleInfo} size={15} /><span>{m.settings_domains_check_idle()}</span>
	</div>
{:else if !manage && actionable}
	<div class="dw-note">
		<Icon icon={faCircleInfo} size={15} /><span>{m.settings_domains_check_idle_member()}</span>
	</div>
{/if}
