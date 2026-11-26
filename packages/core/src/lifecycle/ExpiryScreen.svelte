<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Wordmark from '$core/components/Wordmark.svelte';
	import Icon from '$core/components/Icon.svelte';
	import {
		faCircleArrowDown,
		faClock,
		faDownload,
		faPaperPlane,
		faShare,
		faShieldCheck,
		faSparkles
	} from '@fortawesome/pro-regular-svg-icons';
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

	let busy = $state(false);
	let failed = $state(false);

	async function leaveTo(path: string) {
		if (busy) return;
		busy = true;
		failed = false;
		try {
			await markExpiryScreenShown();
			if (auth.accountId) await auth.loadProfile(auth.accountId);
			await goto(path);
		} catch {
			failed = true;
		} finally {
			busy = false;
		}
	}

	function choosePlan() {
		lifecycle.markRestoreOrigin('grace');
		void leaveTo(`/u/${slot}/lifecycle/restore`);
	}
	function downloadData() {
		void leaveTo(`/u/${slot}/lifecycle/export`);
	}
	function continueReadOnly() {
		void leaveTo(`/u/${slot}/mail/inbox`);
	}
	function moveToFree() {
		void leaveTo(`/u/${slot}/lifecycle/downgrade`);
	}
</script>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<div class="card lc-mid">
	<div class="card-surface">
		<Wordmark size="large" class="lc-mark" />
		<div class="card-head">
			<p class="eyebrow">{m.lc_expiry_eyebrow()}</p>
			<h1>{m.lc_expiry_title()}</h1>
		</div>
		<div class="lc-reassure">
			<Icon icon={faShieldCheck} size={16} />{m.lc_expiry_reassure({ count: ctx.retentionDays })}
		</div>
		<PersonalTimeline {ctx} />
		<ul class="lc-changed">
			<li class="ch-h">{m.lc_expiry_changed_heading()}</li>
			<li>
				<Icon icon={faPaperPlane} size={16} /><span
					><Rich text={m.lc_expiry_changed_sending()} tags={{ b: bold }} /></span
				>
			</li>
			<li>
				<Icon icon={faShare} size={16} /><span><b>{m.lc_expiry_changed_forwarding()}</b></span>
			</li>
			<li>
				<Icon icon={faClock} size={16} /><span><Rich text={m.lc_expiry_changed_scheduled()} tags={{ b: bold }} /></span>
			</li>
		</ul>
		<div class="lc-cta">
			<Button variant="primary" size="lg" disabled={busy} onclick={choosePlan}><Icon icon={faSparkles} size={17} />{m.lc_expiry_choose_plan()}</Button>
			{#if canMoveToFree}
				<Button variant="secondary" size="lg" disabled={busy} onclick={moveToFree}>
					<Icon icon={faCircleArrowDown} size={17} />{m.lc_expiry_move_to_free()}
				</Button>
			{/if}
			<Button variant="secondary" size="lg" disabled={busy} onclick={downloadData}>
				<Icon icon={faDownload} size={17} />{m.lc_download_my_data()}
			</Button>
			<Button variant="ghost" size="lg" disabled={busy} onclick={continueReadOnly}>{m.lc_expiry_continue_read_only()}</Button>
		</div>
		{#if failed}
			<p class="errtext" role="alert">{m.lc_expiry_failed()}</p>
		{/if}
		<p class="lc-cta-note">
			{m.lc_expiry_note()}
		</p>
	</div>
</div>
