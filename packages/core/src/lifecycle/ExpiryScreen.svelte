<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import mark from '$core/assets/logo-mark.svg';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Send from '@lucide/svelte/icons/send';
	import Forward from '@lucide/svelte/icons/forward';
	import Clock from '@lucide/svelte/icons/clock';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Download from '@lucide/svelte/icons/download';
	import CircleArrowDown from '@lucide/svelte/icons/circle-arrow-down';
	import PersonalTimeline from './PersonalTimeline.svelte';
	import { lifecycle } from './lifecycle.svelte';
	import { markExpiryScreenShown } from '$core/api/lifecycle';
	import { auth } from '$core/stores/auth.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { entryPointVisible } from './downgrade';
	import type { LifecycleContext } from './types';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import { Button } from '$core/components/ui/button';

	let { ctx }: { ctx: LifecycleContext } = $props();

	const slot = $derived(page.params.slot ?? '0');
	const canMoveToFree = $derived(entryPointVisible(billing.subscription));

	async function markShown() {
		try {
			await markExpiryScreenShown();
			if (auth.accountId) await auth.loadProfile(auth.accountId);
		} catch {}
	}

	async function choosePlan() {
		lifecycle.markRestoreOrigin('grace');
		await markShown();
		void goto(`/u/${slot}/lifecycle/restore`);
	}
	async function downloadData() {
		await markShown();
		void goto(`/u/${slot}/lifecycle/export`);
	}
	async function continueReadOnly() {
		await markShown();
		void goto(`/u/${slot}/mail/inbox`);
	}
	async function moveToFree() {
		await markShown();
		void goto(`/u/${slot}/lifecycle/downgrade`);
	}
</script>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<div class="card lc-mid">
	<div class="card-surface screen-fade">
		<img class="lc-mark" src={mark} alt="Thelemail" />
		<div class="card-head">
			<p class="eyebrow">{m.lc_expiry_eyebrow()}</p>
			<h1>{m.lc_expiry_title()}</h1>
		</div>
		<div class="lc-reassure">
			<ShieldCheck size={16} />{m.lc_expiry_reassure({ count: ctx.retentionDays })}
		</div>
		<PersonalTimeline {ctx} />
		<ul class="lc-changed">
			<li class="ch-h">{m.lc_expiry_changed_heading()}</li>
			<li>
				<Send size={16} /><span
					><Rich text={m.lc_expiry_changed_sending()} tags={{ b: bold }} /></span
				>
			</li>
			<li>
				<Forward size={16} /><span><b>{m.lc_expiry_changed_forwarding()}</b></span>
			</li>
			<li>
				<Clock size={16} /><span><Rich text={m.lc_expiry_changed_scheduled()} tags={{ b: bold }} /></span>
			</li>
		</ul>
		<div class="lc-cta">
			<Button variant="primary" size="lg" onclick={choosePlan}><Sparkles size={17} />{m.lc_expiry_choose_plan()}</Button>
			{#if canMoveToFree}
				<Button variant="secondary" size="lg" onclick={moveToFree}>
					<CircleArrowDown size={17} />{m.lc_expiry_move_to_free()}
				</Button>
			{/if}
			<Button variant="secondary" size="lg" onclick={downloadData}>
				<Download size={17} />{m.lc_download_my_data()}
			</Button>
			<Button variant="ghost" size="lg" onclick={continueReadOnly}>{m.lc_expiry_continue_read_only()}</Button>
		</div>
		<p class="lc-cta-note">
			{m.lc_expiry_note()}
		</p>
	</div>
</div>
