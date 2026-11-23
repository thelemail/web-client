<script lang="ts">
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Wordmark from '$core/components/Wordmark.svelte';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowTurnLeftUp,
		faCircleCheck,
		faDownload,
		faKey,
		faLifeRing,
		faLock,
		faRotateLeft,
		faTriangleExclamation
	} from '@fortawesome/pro-regular-svg-icons';
	import { lifecycle } from './lifecycle.svelte';
	import { setNotificationEmail } from '$core/api/lifecycle';
	import { fmt } from './dates';
	import type { LifecycleContext } from './types';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import { announce } from '$core/announce';

	let { ctx }: { ctx: LifecycleContext } = $props();

	const slot = $derived(page.params.slot ?? '0');

	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	function flash(text: string) {
		toast = text;
		announce(text);
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
		} catch (err) {
			if (isReauthenticationRequired(err)) return;
			flash(m.lc_suspended_email_save_failed());
		} finally {
			emailBusy = false;
		}
	}

	function restore() {
		lifecycle.markRestoreOrigin('suspended');
		void goto(`/u/${slot}/lifecycle/restore`);
	}
</script>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}
{#snippet mono(text: string)}<span class="mono">{text}</span>{/snippet}

<div class="lc-gate">
	<div class="lc-gate-top"><Wordmark size="large" /></div>
	<div class="lc-gate-body">
		<div class="lc-gate-card">
			<div class="lc-gate-seal"><Icon icon={faLock} size={26} /></div>
			<h1>{m.lc_suspended_title()}</h1>
			<p class="lede">
				<Rich text={m.lc_suspended_lede({ date: fmt.full(ctx.dates.remove) })} tags={{ b: bold }} />
			</p>
			<div class="lc-honesty">
				<div class="hl">
					<Icon icon={faArrowTurnLeftUp} size={16} />
					<span
						><Rich
							text={m.lc_suspended_returning({ date: fmt.med(ctx.dates.suspend) })}
							tags={{ date: mono }}
						/></span
					>
				</div>
				<div class="hl">
					<Icon icon={faTriangleExclamation} size={16} />
					<span>{m.lc_suspended_sign_in_errors()}</span>
				</div>
			</div>
			<div class="lc-gate-actions">
				<button class="lc-gbtn primary" onclick={restore}>
					<Icon icon={faRotateLeft} size={17} />{m.lc_suspended_restore()}
				</button>
				<button class="lc-gbtn ghost" onclick={() => goto(`/u/${slot}/lifecycle/export`)}>
					<Icon icon={faDownload} size={17} />{m.lc_download_my_data()}
				</button>
				<button class="lc-gbtn ghost" onclick={() => (emailOpen = !emailOpen)}>
					<Icon icon={faKey} size={17} />{m.lc_suspended_add_email()}
				</button>
				<button class="lc-gbtn ghost" onclick={() => flash(m.lc_suspended_support_toast())}>
					<Icon icon={faLifeRing} size={17} />{m.lc_suspended_contact_support()}
				</button>
			</div>
			{#if emailOpen}
				<div class="lc-email-form">
					{#if emailSent}
						<p class="lc-email-note">
							<Icon icon={faCircleCheck} size={15} /><Rich
								text={m.lc_suspended_email_sent({ email: emailValue.trim() })}
								tags={{ email: mono }}
							/>
						</p>
					{:else}
						<p class="lc-email-note">
							{m.lc_suspended_email_intro()}
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
								{m.lc_suspended_send_link()}
							</button>
						</div>
					{/if}
				</div>
			{/if}
			<div class="lc-gate-foot">
				{m.lc_suspended_foot({
					domain: ctx.domain,
					suspended: fmt.med(ctx.dates.suspend),
					deletion: fmt.med(ctx.dates.remove)
				})}
			</div>
		</div>
	</div>
</div>

{#if toast}
	<div class="lc-toast"><Icon icon={faCircleCheck} size={16} />{toast}</div>
{/if}
