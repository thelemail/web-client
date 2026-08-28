<script lang="ts">
	import '$lib/settings/settings.css';
	import '$lib/lifecycle/lifecycle.css';
	import Check from '@lucide/svelte/icons/check';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
	import SettingsNav from '$lib/settings/SettingsNav.svelte';
	import Ceremonies from '$lib/settings/ceremonies/Ceremonies.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
	import { ensureAccountData } from '$lib/stores/accountData';
	import { preferences } from '$lib/stores/preferences.svelte';
	import { auth } from '$lib/stores/auth.svelte';

	let { children, data } = $props();

	const accountEmail = $derived(auth.email ?? '');

	let scrollRef: HTMLDivElement | undefined = $state();

	$effect(() => {
		const accountId = data.accountId;
		if (!accountId || !auth.canEnterApp) return;
		settingsDraft.setAccount(accountId);
		ensureAccountData(accountId);
		void settingsDraft.hydrate();
	});

	$effect(() => {
		preferences.density = settingsDraft.s.density;
		preferences.highContrast = settingsDraft.s.highContrast;
		preferences.reduceMotion = settingsDraft.s.reduceMotion;
		preferences.textScale = settingsDraft.s.textScale;
	});

	$effect(() => {
		void page.url.pathname;
		scrollRef?.scrollTo({ top: 0 });
	});

	beforeNavigate(() => settingsDraft.flushPending());

	afterNavigate(() => {
		if (page.url.searchParams.get('ceremony') !== 'recovery') return;
		settingsDraft.launch('recovery');
		replaceState(page.url.pathname, {});
	});
</script>

<div
	class="settings-app"
	data-accent={preferences.accent}
	data-density={preferences.density}
	data-contrast={preferences.highContrast ? 'high' : 'normal'}
	data-motion={preferences.reduceMotion ? 'reduced' : 'full'}
>
	<div class="settings-body">
		<SettingsNav />

		<div class="set-col">
			<header class="set-head">
				<div class="ht">
					<h1>Settings</h1>
					<div class="sub">
						<span>Personal preferences for</span>
						<span class="mono">{accountEmail}</span>
						<span class="sub-dot"></span>
						<span>only affects your mailbox</span>
					</div>
				</div>
				<div class="save-wrap">
					<div class="autosave {settingsDraft.saveState}" aria-live="polite">
						{#if settingsDraft.saveState === 'saving'}
							<span class="as-spin"></span><span class="as-tx">Saving…</span>
						{:else if settingsDraft.saveState === 'saved'}
							<Check size={14} /><span class="as-tx">Saved</span>
						{:else}
							<RefreshCw size={13} /><span class="as-tx">Changes save automatically</span>
						{/if}
					</div>
				</div>
			</header>

			<div class="set-scroll" bind:this={scrollRef} style:--tscale={settingsDraft.s.textScale / 100}>
				<div class="set-content">{@render children()}</div>
			</div>
		</div>
	</div>
</div>

{#if settingsDraft.toastText}
	<div class="set-toast"><CircleCheck size={16} />{settingsDraft.toastText}</div>
{/if}

<Ceremonies
	active={settingsDraft.ceremony}
	twoFaMethod={settingsDraft.ceremonyTwoFaMethod}
	onClose={settingsDraft.close}
	onComplete={settingsDraft.complete}
/>
