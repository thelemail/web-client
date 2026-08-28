<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';

	import DomainWizard from '$lib/settings/domains/DomainWizard.svelte';
	import SecHead from '$lib/settings/SecHead.svelte';
	import { isDomainStep, resumeStep, type DomainStep } from '$lib/settings/domains/steps';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';

	const slot = $derived(page.params.slot ?? '0');
	const base = $derived(`/u/${slot}/settings/domains`);
	const domainId = $derived(page.params.domainId ?? '');

	const domain = $derived(customDomains.items.find((d) => d.id === domainId) ?? null);
	const records = $derived(customDomains.records.get(domainId) ?? []);

	let loadError = $state<string | null>(null);
	let picked = $state<DomainStep | null>(null);
	let loadedFor = '';

	const urlStep = $derived(page.url.searchParams.get('step'));
	const step = $derived(
		picked ?? (isDomainStep(urlStep) ? urlStep : domain ? resumeStep(domain) : 'ownership')
	);

	function select(s: DomainStep) {
		picked = s;
		const url = new URL(page.url);
		url.searchParams.set('step', s);
		replaceState(url, page.state);
	}

	$effect(() => {
		const ws = workspaces.workspace?.id;
		const id = domainId;
		if (!ws || !id || loadedFor === id) return;
		loadedFor = id;
		picked = null;
		customDomains.fetchDetail(ws, id).catch((err) => {
			loadError = err instanceof Error ? err.message : 'Could not load this domain';
		});
	});
</script>

<svelte:head>
	<title>Thelemail — {domain?.domain ?? 'Domain setup'}</title>
</svelte:head>

<SecHead
	title={domain?.domain ?? 'Domain setup'}
	desc="Prove ownership, set up sending, create the addresses that will receive mail, then point MX here last."
/>

<p class="dw-back"><a class="btn btn-ghost" href={base}><ArrowLeft size={15} />All domains</a></p>

{#if loadError}
	<div class="dw-note bad"><CircleAlert size={15} /><span>{loadError}</span></div>
{:else if !domain}
	<div class="dw-note"><span>Loading domain…</span></div>
{:else}
	<DomainWizard {domain} {records} {step} onStep={select} />
{/if}

<style>
	.dw-back {
		margin: 0 0 12px;
	}
</style>
