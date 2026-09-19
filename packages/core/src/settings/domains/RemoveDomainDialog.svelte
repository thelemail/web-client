<script lang="ts">
	import AtSign from '@lucide/svelte/icons/at-sign';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Globe from '@lucide/svelte/icons/globe';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	import CeremonyShell from '../CeremonyShell.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { addresses } from '$core/stores/addresses.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import type { CustomDomain } from '$core/api/customDomains';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		domain: CustomDomain;
		onClose: () => void;
		onRemoved: (domain: string) => void;
	}

	let { domain, onClose, onRemoved }: Props = $props();

	let confirmText = $state('');
	let ack = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const target = $derived(domain.domain);
	const canRemove = $derived(ack && confirmText.trim().toLowerCase() === target && !busy);
	const count = $derived(domain.addressCount);

	async function submit() {
		if (!canRemove) return;
		const ws = workspaces.workspace?.id;
		if (!ws) {
			error = m.settings_domains_no_workspace();
			return;
		}
		busy = true;
		error = null;
		try {
			await customDomains.remove(ws, domain.id);
			void addresses.load();
			onRemoved(target);
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : m.settings_domains_remove_failed();
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell
	icon={Trash2}
	eyebrow={m.settings_domains_remove_eyebrow()}
	title={m.settings_domains_remove_title({ domain: target })}
	tone="danger"
	{onClose}
>
	<div class="cer-pane">
		<div class="cer-lede">
			<p><Rich text={m.settings_domains_remove_lede({ domain: target })} tags={{ b: bold }} /></p>
		</div>
		<ul class="cer-points">
			<li>
				<Inbox size={16} />
				<span>{m.settings_domains_remove_point_mail()}</span>
			</li>
			<li>
				<AtSign size={16} />
				<span>
					{#if count === 0}
						{m.settings_domains_remove_point_no_addresses()}
					{:else}
						{m.settings_domains_remove_point_addresses({ count })}
					{/if}
				</span>
			</li>
			<li>
				<Globe size={16} />
				<span>{m.settings_domains_remove_point_registrar()}</span>
			</li>
		</ul>

		<label class="cer-ack danger">
			<input type="checkbox" bind:checked={ack} />
			<span>{m.settings_domains_remove_ack()}</span>
		</label>

		<div class="field">
			<label for="rm-domain-confirm"><Rich text={m.settings_domains_remove_type_confirm({ domain: target })} tags={{ mono }} /></label>
			<input
				id="rm-domain-confirm"
				class="tin mono"
				bind:value={confirmText}
				placeholder={target}
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
			/>
		</div>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>
			{m.settings_domains_remove_keep()}
		</Button>
		<Button variant="danger" disabled={!canRemove} onclick={submit}>
			{busy ? m.settings_domains_removing() : m.settings_domains_remove()}
		</Button>
	{/snippet}
</CeremonyShell>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

{#snippet mono(t: string)}<span class="mono">{t}</span>{/snippet}
