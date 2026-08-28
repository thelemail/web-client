<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Globe from '@lucide/svelte/icons/globe';
	import Info from '@lucide/svelte/icons/info';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import Card from '$lib/settings/Card.svelte';
	import SecHead from '$lib/settings/SecHead.svelte';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { resumeStep } from '$lib/settings/domains/steps';

	const slot = $derived(page.params.slot ?? '0');
	const base = $derived(`/u/${slot}/settings/domains`);

	let name = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);

	const clean = $derived(
		name
			.trim()
			.toLowerCase()
			.replace(/^https?:\/\//, '')
			.replace(/\/.*$/, '')
			.replace(/\.$/, '')
	);
	const valid = $derived(
		/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(clean)
	);

	async function submit() {
		if (!valid || submitting) return;
		const ws = workspaces.workspace?.id;
		if (!ws) {
			error = 'No workspace loaded. Refresh the page and try again.';
			return;
		}
		submitting = true;
		error = null;
		try {
			const created = await customDomains.create(ws, clean);
			await goto(`${base}/${created.domain.id}?step=${resumeStep(created.domain)}`, {
				replaceState: true
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not add domain';
			submitting = false;
		}
	}
</script>

<svelte:head><title>Thelemail — Add a domain</title></svelte:head>

<SecHead
	title="Add a domain"
	desc="Setup runs in order: prove you own the domain, set up sending, create the addresses that will receive mail, then point MX here last. Nothing about your current mail changes until the final step."
/>

<Card>
	{#snippet head()}
		<Globe size={16} />
		<h3>Which domain?</h3>
	{/snippet}

	<div class="dw-pane">
		<div class="field">
			<label for="new-domain-name">Domain name</label>
			<div class="input-prefix">
				<span class="ip-ic"><Globe size={16} /></span>
				<input
					id="new-domain-name"
					class="tin mono"
					bind:value={name}
					placeholder="example.com"
					autocomplete="off"
					onkeydown={(e) => e.key === 'Enter' && submit()}
				/>
			</div>
			{#if name.length > 0 && !valid}
				<div class="field-hint bad">
					<CircleAlert size={13} />Enter a bare domain like
					<span class="mono">example.com</span>, with no
					<span class="mono">http://</span> and no path.
				</div>
			{/if}
			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		</div>
		<div class="dw-note">
			<Info size={15} />
			<span>You will need access to this domain's DNS settings at your registrar.</span>
		</div>
	</div>

	<div class="dw-foot">
		<a class="btn btn-ghost" href={base}><ArrowLeft size={15} />Cancel</a>
		<span class="dw-spacer"></span>
		<button type="button" class="btn btn-primary" disabled={!valid || submitting} onclick={submit}>
			{submitting ? 'Adding…' : 'Continue'}<ArrowRight size={15} />
		</button>
	</div>
</Card>
