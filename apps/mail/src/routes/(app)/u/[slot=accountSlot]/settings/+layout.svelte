<script lang="ts">
	import '$core/settings/settings.css';
	import '$core/lifecycle/lifecycle.css';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import SettingsNav from '$core/settings/SettingsNav.svelte';
	import { sectionLabelFromPath } from '$core/settings/data';
	import { settingsPageTitle } from '$core/settings/pageTitle.svelte';
	import Ceremonies from '$core/settings/ceremonies/Ceremonies.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
	import { ensureAccountData } from '$core/stores/accountData';
	import { auth } from '$core/stores/auth.svelte';
	import { m } from '$paraglide/messages.js';

	let { children, data } = $props();

	const sectionLabel = $derived(
		settingsPageTitle.value ?? sectionLabelFromPath(page.url.pathname)
	);

	let scrollRef: HTMLDivElement | undefined = $state();

	$effect(() => {
		const accountId = data.accountId;
		if (!accountId || !auth.canEnterApp) return;
		settingsDraft.setAccount(accountId);
		ensureAccountData(accountId);
		void settingsDraft.hydrate();
	});

	$effect(() => {
		void page.url.pathname;
		scrollRef?.scrollTo({ top: 0 });
	});

	beforeNavigate(({ shallow }) => {
		if (shallow) return;
		settingsDraft.flushPending();
	});

	afterNavigate(({ shallow }) => {
		if (shallow) return;
		if (page.url.searchParams.get('ceremony') !== 'recovery') return;
		settingsDraft.launch('recovery');
		void goto(page.url.pathname, { shallow: true, replace: true, state: {} });
	});
</script>

<div class="settings-app">
	<div class="settings-body">
		<SettingsNav />

		<div class="set-col">
			<header class="set-head">
				{#if settingsPageTitle.crumb}
					<div class="set-crumb">
						<a href={settingsPageTitle.crumb.href}>{settingsPageTitle.crumb.label}</a>
						<ChevronRight size={14} />
						<h1 class:mono={settingsPageTitle.mono}>{sectionLabel}</h1>
					</div>
				{:else}
					<h1>{sectionLabel}</h1>
				{/if}
				<div class="autosave {settingsDraft.saveState}" aria-live="polite">
					{#if settingsDraft.saveState === 'saving'}
						<span class="as-spin"></span><span class="as-tx">{m.settings_autosave_saving()}</span>
					{:else if settingsDraft.saveState === 'saved'}
						<Check size={14} /><span class="as-tx">{m.settings_autosave_saved()}</span>
					{:else if settingsDraft.saveState === 'error'}
						<CircleAlert size={14} /><span class="as-tx">{m.settings_autosave_failed()}</span>
						<button
							type="button"
							class="as-retry"
							aria-label="{m.settings_autosave_failed()}, {m.common_retry()}"
							onclick={settingsDraft.retrySave}>{m.common_retry()}</button
						>
					{/if}
				</div>
			</header>

			<div class="set-scroll" bind:this={scrollRef}>
				<div class="set-content">{@render children()}</div>
			</div>
		</div>
	</div>
</div>

{#if settingsDraft.toast}
	<div class="set-toast" class:err={settingsDraft.toast.kind === 'error'}>
		{#if settingsDraft.toast.kind === 'error'}<CircleAlert size={16} />{:else}<CircleCheck size={16} />{/if}
		{settingsDraft.toast.text}
	</div>
{/if}

<Ceremonies
	active={settingsDraft.ceremony}
	twoFaMethod={settingsDraft.ceremonyTwoFaMethod}
	onClose={settingsDraft.close}
	onComplete={settingsDraft.complete}
/>
