<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import wordmark from '$lib/assets/logo-wordmark-inverse.svg';
	import Lock from '@lucide/svelte/icons/lock';
	import CornerUpLeft from '@lucide/svelte/icons/corner-up-left';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Download from '@lucide/svelte/icons/download';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { lifecycle } from './lifecycle.svelte';
	import { setNotificationEmail } from '$lib/api/lifecycle';
	import { fmt } from './dates';
	import type { LifecycleContext } from './types';

	let { ctx }: { ctx: LifecycleContext } = $props();

	const slot = $derived(page.params.slot ?? '0');

	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	function flash(text: string) {
		toast = text;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 2600);
	}

	let emailOpen = $state(false);
	let emailValue = $state('');
	let emailBusy = $state(false);
	let emailSent = $state(false);
	const emailValid = $derived(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailValue.trim()));

	async function submitEmail() {
		if (!emailValid || emailBusy) return;
		emailBusy = true;
		try {
			await setNotificationEmail({ email: emailValue.trim() });
			emailSent = true;
		} catch {
			flash('Could not save that address. Please try again.');
		} finally {
			emailBusy = false;
		}
	}

	function restore() {
		lifecycle.markRestoreOrigin('suspended');
		void goto(`/u/${slot}/lifecycle/restore`);
	}
</script>

<div class="lc-gate">
	<div class="lc-gate-top"><img class="wm" src={wordmark} alt="Thelemail" /></div>
	<div class="lc-gate-body">
		<div class="lc-gate-card">
			<div class="lc-gate-seal"><Lock size={26} /></div>
			<h1>Your mailbox is suspended.</h1>
			<p class="lede">
				Your data is safe until <b>{fmt.full(ctx.dates.remove)}</b>. Restore any time before then and
				everything comes back exactly as it was.
			</p>
			<div class="lc-honesty">
				<div class="hl">
					<CornerUpLeft size={16} />
					<span
						>Mail sent to you since <span class="mono">{fmt.med(ctx.dates.suspend)}</span> is being
						returned to senders.</span
					>
				</div>
				<div class="hl">
					<TriangleAlert size={16} />
					<span>Your mail apps will show sign-in errors while suspended — that's expected.</span>
				</div>
			</div>
			<div class="lc-gate-actions">
				<button class="lc-gbtn primary" onclick={restore}>
					<RotateCcw size={17} />Restore my account
				</button>
				<button class="lc-gbtn ghost" onclick={() => goto(`/u/${slot}/lifecycle/export`)}>
					<Download size={17} />Download my data
				</button>
				<button class="lc-gbtn ghost" onclick={() => (emailOpen = !emailOpen)}>
					<KeyRound size={17} />Add a notification email
				</button>
				<button class="lc-gbtn ghost" onclick={() => flash('Support — opens a contact form')}>
					<LifeBuoy size={17} />Contact support
				</button>
			</div>
			{#if emailOpen}
				<div class="lc-email-form">
					{#if emailSent}
						<p class="lc-email-note">
							<CircleCheck size={15} />Check <span class="mono">{emailValue.trim()}</span> for a link to
							confirm. Once verified, we can reach you here even while suspended.
						</p>
					{:else}
						<p class="lc-email-note">
							An outside address is the only way we can reach you after suspension. We send a
							confirmation link, then use it only for account notices.
						</p>
						<div class="lc-email-row">
							<input
								class="lc-email-input"
								type="email"
								placeholder="you@example.com"
								bind:value={emailValue}
								disabled={emailBusy}
							/>
							<button class="lc-gbtn primary" disabled={!emailValid || emailBusy} onclick={submitEmail}>
								Send link
							</button>
						</div>
					{/if}
				</div>
			{/if}
			<div class="lc-gate-foot">
				{ctx.domain} · suspended {fmt.med(ctx.dates.suspend)} · deletion {fmt.med(ctx.dates.remove)}
			</div>
		</div>
	</div>
</div>

{#if toast}
	<div class="lc-toast"><CircleCheck size={16} />{toast}</div>
{/if}
