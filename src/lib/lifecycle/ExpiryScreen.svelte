<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import mark from '$lib/assets/logo-mark.svg';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Send from '@lucide/svelte/icons/send';
	import Forward from '@lucide/svelte/icons/forward';
	import Clock from '@lucide/svelte/icons/clock';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Download from '@lucide/svelte/icons/download';
	import PersonalTimeline from './PersonalTimeline.svelte';
	import { lifecycle } from './lifecycle.svelte';
	import { markExpiryScreenShown } from '$lib/api/lifecycle';
	import { auth } from '$lib/stores/auth.svelte';
	import type { LifecycleContext } from './types';

	let { ctx }: { ctx: LifecycleContext } = $props();

	const slot = $derived(page.params.slot ?? '0');

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
</script>

<div class="card lc-mid">
	<div class="card-surface screen-fade">
		<img class="lc-mark" src={mark} alt="Thelemail" />
		<div class="card-head">
			<p class="eyebrow">Subscription ended</p>
			<h1>Your subscription ended. Your mail is safe.</h1>
		</div>
		<div class="lc-reassure">
			<ShieldCheck size={16} />Nothing has been deleted. You have {ctx.retentionDays} days to decide.
		</div>
		<PersonalTimeline {ctx} />
		<ul class="lc-changed">
			<li class="ch-h">What changed</li>
			<li>
				<Send size={16} /><span
					><b>Sending is paused.</b> You can still read, search, and receive mail.</span
				>
			</li>
			<li>
				<Forward size={16} /><span><b>Auto-forwarding and auto-replies are off.</b></span>
			</li>
			<li>
				<Clock size={16} /><span><b>Scheduled sends moved to Drafts.</b> Nothing was sent.</span>
			</li>
		</ul>
		<div class="lc-cta">
			<button class="btn btn-primary" onclick={choosePlan}><Sparkles size={17} />Choose a plan</button>
			<button class="btn btn-secondary" onclick={downloadData}>
				<Download size={17} />Download my data
			</button>
			<button class="btn btn-ghost" onclick={continueReadOnly}>Continue in read-only</button>
		</div>
		<p class="lc-cta-note">
			You'll see this once. After today, a banner in your mailbox carries the same information.
		</p>
	</div>
</div>
