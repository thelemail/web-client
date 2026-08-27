<script lang="ts">
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Plus from '@lucide/svelte/icons/plus';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CeremonyShell from '../CeremonyShell.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import Select from '../Select.svelte';
	import type { CeremonyKind } from '../data';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { addresses } from '$lib/stores/addresses.svelte';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	const steps = ['Identity', 'Done'];
	let step = $state(0);
	let local = $state('');
	let name = $state('');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);

	const verifiedDomains = $derived(customDomains.items.filter((d) => d.status === 'verified'));
	let userPickedDomainId = $state<string | null>(null);

	const selectedDomain = $derived(
		verifiedDomains.find((d) => d.id === userPickedDomainId) ?? verifiedDomains[0] ?? null
	);
	const domainOptions = $derived(verifiedDomains.map((d) => d.domain));
	const selectedDomainName = $derived(selectedDomain?.domain ?? '');

	const localOk = $derived(/^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?$/i.test(local.trim()));
	const full = $derived((local.trim() || 'name') + '@' + (selectedDomainName || 'example.com'));

	function pickDomain(name: string) {
		const d = verifiedDomains.find((d) => d.domain === name);
		if (d) userPickedDomainId = d.id;
	}

	async function submit() {
		if (!localOk || !selectedDomain || submitting) return;
		submitting = true;
		submitError = null;
		try {
			const trimmedName = name.trim();
			await addresses.add({
				customDomainId: selectedDomain.id,
				localPart: local.trim().toLowerCase(),
				name: trimmedName === '' ? undefined : trimmedName
			});
			step = 1;
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Could not add address';
		} finally {
			submitting = false;
		}
	}
</script>

<CeremonyShell
	icon={AtSign}
	eyebrow="Addresses"
	title="Add an address"
	{steps}
	{step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					An address is an identity you can send and receive as. Pick a local part on a verified
					custom domain. Inbound mail lands in your mailbox; you can choose this address as your
					Compose From.
				</p>
			</div>
			{#if verifiedDomains.length === 0}
				<div class="inline-warn">
					<CircleAlert size={15} />
					<span
						>You need a verified custom domain before you can add addresses. Open <b>Custom domains</b
						> and add one.</span
					>
				</div>
			{:else}
				<div class="field">
					<label for="add-addr-name">Display name <span class="opt">(optional)</span></label>
					<input
						id="add-addr-name"
						class="tin"
						bind:value={name}
						maxlength="120"
						placeholder="e.g. Family inbox"
						autocomplete="off"
					/>
				</div>
				<div class="field">
					<label for="add-addr-local">Address</label>
					<div class="alias-compose">
						<input
							id="add-addr-local"
							class="tin mono"
							bind:value={local}
							placeholder="hello"
							autocomplete="off"
						/>
						<span class="ac-at">@</span>
						<Select
							value={selectedDomainName}
							options={domainOptions}
							onChange={pickDomain}
						/>
					</div>
					{#if local.length > 0 && !localOk}
						<div class="field-hint bad">
							<CircleAlert size={13} />Use letters, numbers, dots, plus, underscore, or hyphens.
						</div>
					{/if}
					{#if submitError}
						<div class="field-hint bad">
							<CircleAlert size={13} />{submitError}
						</div>
					{/if}
				</div>
				<div class="identity-preview">
					<span class="ip-label">Preview</span>
					<span class="ip-from">
						<span class="mono">{full}</span>
					</span>
				</div>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={AtSign}
			title="Address added"
			desc="It’s ready to send and receive. Use the Compose From-selector to send from it; promote it to primary in Addresses to use as your default."
		>
			<div class="done-pill">
				<span class="mono">{full}</span>
			</div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary"
				disabled={!localOk || !selectedDomain || submitting}
				onclick={submit}
			>
				<Plus size={15} />{submitting ? 'Adding…' : 'Add address'}
			</button>
		{:else}
			<button
				type="button"
				class="btn btn-primary"
				onclick={() => {
					onComplete('address');
					onClose();
				}}>Done</button
			>
		{/if}
	{/snippet}
</CeremonyShell>
