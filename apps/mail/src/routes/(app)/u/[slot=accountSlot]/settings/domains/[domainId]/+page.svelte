<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';

	import DomainWizard from '$core/settings/domains/DomainWizard.svelte';
	import SecHead from '$core/settings/SecHead.svelte';
	import { settingsPageTitle } from '$core/settings/pageTitle.svelte';
	import { isDomainStep, reachableStep, resumeStep, type DomainStep } from '$core/settings/domains/steps';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

	const slot = $derived(page.params.slot ?? '0');
	const base = $derived(`/u/${slot}/settings/domains`);
	const domainId = $derived(page.params.domainId ?? '');

	const domain = $derived(customDomains.items.find((d) => d.id === domainId) ?? null);
	const records = $derived(customDomains.records.get(domainId) ?? []);

	let loadError = $state<string | null>(null);
	let picked = $state<DomainStep | null>(null);
	let loadedFor = '';

	const urlStep = $derived(page.url.searchParams.get('step'));
	const requestedStep = $derived(
		picked ?? (isDomainStep(urlStep) ? urlStep : domain ? resumeStep(domain) : 'ownership')
	);
	const step = $derived(domain ? reachableStep(domain, requestedStep) : requestedStep);

	function select(s: DomainStep) {
		picked = s;
		const url = new URL(page.url);
		url.searchParams.set('step', s);
		replaceState(url, page.state);
	}

	$effect(() => {
		settingsPageTitle.set(domain?.domain ?? m.settings_domains_setup_title());
		return () => settingsPageTitle.set(null);
	});

	$effect(() => {
		const ws = workspaces.workspace?.id;
		const id = domainId;
		if (!ws || !id || loadedFor === id) return;
		loadedFor = id;
		picked = null;
		customDomains.fetchDetail(ws, id).catch((err) => {
			loadError = err instanceof Error ? err.message : m.settings_domains_load_failed();
		});
	});
</script>

<svelte:head>
	<title>{m.settings_page_title({ page: domain?.domain ?? m.settings_domains_setup_title() })}</title>
</svelte:head>

<SecHead desc={m.settings_domains_setup_desc()} />

<p class="dw-back"><Button variant="ghost" href={base}><ArrowLeft size={15} />{m.settings_domains_wizard_all_domains()}</Button></p>

{#if loadError}
	<div class="dw-note bad"><CircleAlert size={15} /><span>{loadError}</span></div>
{:else if !domain}
	<div class="dw-note"><span>{m.settings_domains_loading_one()}</span></div>
{:else}
	<DomainWizard {domain} {records} {step} listHref={base} onStep={select} />
{/if}

<style>
	.dw-back {
		margin: 0 0 12px;
	}
</style>
