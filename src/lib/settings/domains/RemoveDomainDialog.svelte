<script lang="ts">
	import AtSign from '@lucide/svelte/icons/at-sign';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Globe from '@lucide/svelte/icons/globe';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	import CeremonyShell from '../CeremonyShell.svelte';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import type { CustomDomain } from '$lib/api/customDomains';

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
			error = 'No workspace loaded. Refresh the page and try again.';
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
			error = err instanceof Error ? err.message : 'Could not remove this domain';
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell
	icon={Trash2}
	eyebrow="Domains"
	title="Remove {target}"
	tone="danger"
	{onClose}
>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>This cannot be undone from here. Removing <b>{target}</b> means:</p>
		</div>
		<ul class="cer-points">
			<li>
				<Inbox size={16} />
				<span>Mail sent to this domain stops arriving. Senders get a bounce.</span>
			</li>
			<li>
				<AtSign size={16} />
				<span>
					{#if count === 0}
						No addresses exist on this domain yet.
					{:else}
						{count} address{count === 1 ? '' : 'es'} on this domain
						{count === 1 ? 'is' : 'are'} removed with it. Mail already delivered stays in the mailbox
						it landed in.
					{/if}
				</span>
			</li>
			<li>
				<Globe size={16} />
				<span>The domain stays yours at your registrar, and another workspace can claim it.</span>
			</li>
		</ul>

		<label class="cer-ack danger">
			<input type="checkbox" bind:checked={ack} />
			<span>I understand mail to this domain will stop being accepted.</span>
		</label>

		<div class="field">
			<label for="rm-domain-confirm">Type <span class="mono">{target}</span> to confirm</label>
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
		<button type="button" class="btn btn-ghost" disabled={busy} onclick={onClose}>
			Keep this domain
		</button>
		<button type="button" class="btn btn-danger" disabled={!canRemove} onclick={submit}>
			{busy ? 'Removing…' : 'Remove domain'}
		</button>
	{/snippet}
</CeremonyShell>
