<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Globe from '@lucide/svelte/icons/globe';
	import Info from '@lucide/svelte/icons/info';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import Card from '$core/settings/Card.svelte';
	import SecHead from '$core/settings/SecHead.svelte';
	import { settingsPageTitle } from '$core/settings/pageTitle.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import UpgradeNudge from '$core/settings/UpgradeNudge.svelte';
	import { resumeStep } from '$core/settings/domains/steps';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

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
			error = m.settings_domains_no_workspace();
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
			error = err instanceof Error ? err.message : m.settings_domains_add_failed();
			submitting = false;
		}
	}

	$effect(() => {
		settingsPageTitle.set(m.settings_domains_add());
		return () => settingsPageTitle.set(null);
	});
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_domains_add() })}</title></svelte:head>

<SecHead desc={m.settings_domains_new_desc()} />

{#if !billing.canAddDomains}
	<div class="upgrade-list">
		<UpgradeNudge
			title={m.settings_domains_nudge_title()}
			desc={m.settings_domains_nudge_desc()}
		/>
	</div>
{:else}
<Card>
	{#snippet head()}
		<Globe size={16} />
		<h3>{m.settings_domains_new_title()}</h3>
	{/snippet}

	<div class="dw-pane">
		<div class="field">
			<label for="new-domain-name">{m.settings_domains_new_name()}</label>
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
					<CircleAlert size={13} /><Rich text={m.settings_domains_new_invalid()} tags={{ mono }} />
				</div>
			{/if}
			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		</div>
		<div class="dw-note">
			<Info size={15} />
			<span>{m.settings_domains_new_dns_note()}</span>
		</div>
	</div>

	<div class="dw-foot">
		<Button variant="ghost" href={base}><ArrowLeft size={15} />{m.common_cancel()}</Button>
		<span class="dw-spacer"></span>
		<Button variant="primary" disabled={!valid || submitting} onclick={submit}>
			{submitting ? m.settings_domains_new_adding() : m.common_continue()}<ArrowRight size={15} />
		</Button>
	</div>
</Card>
{/if}

{#snippet mono(t: string)}<span class="mono">{t}</span>{/snippet}
