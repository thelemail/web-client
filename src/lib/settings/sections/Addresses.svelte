<script lang="ts">
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import SecHead from '../SecHead.svelte';
	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import AddRow from '../AddRow.svelte';
	import CatchAllCard from './CatchAllCard.svelte';
	import type { CeremonyKind, SettingsState } from '../data';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { auth } from '$lib/stores/auth.svelte';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

	let editingNameFor = $state<string | null>(null);
	let editingNameValue = $state('');
	let renameError = $state<string | null>(null);

	const showCatchAll = $derived(workspaces.isOwner(auth.accountId));

	async function promote(id: string) {
		try {
			await addresses.setPrimary(id);
			await addresses.load();
		} catch (err) {
			console.warn('set primary failed', err);
		}
	}

	async function remove(id: string, email: string) {
		if (!confirm(`Remove ${email}? Mail to it will stop being accepted.`)) return;
		try {
			await addresses.remove(id);
		} catch (err) {
			console.warn('remove failed', err);
		}
	}

	function startRename(id: string, currentName: string | null | undefined) {
		editingNameFor = id;
		editingNameValue = currentName ?? '';
		renameError = null;
	}

	function cancelRename() {
		editingNameFor = null;
		editingNameValue = '';
		renameError = null;
	}

	async function commitRename(id: string) {
		const name = editingNameValue.trim();
		try {
			await addresses.update(id, { name: name === '' ? null : name });
			editingNameFor = null;
			editingNameValue = '';
			renameError = null;
		} catch (err) {
			renameError = err instanceof Error ? err.message : 'Could not rename';
		}
	}
</script>

<SecHead
	tag="02 — Addresses"
	title="Addresses"
	desc="The identities you send and receive as. Promoting one to primary makes it your default From and your sign-in email."
/>

<div class="scard">
	<CardHead icon={AtSign} title="Addresses">
		{#snippet right()}<span class="card-meta">{addresses.items.length} identities</span>{/snippet}
	</CardHead>
	{#if addresses.loading && addresses.items.length === 0}
		<div class="alias-row"><div class="alias-info"><div class="alias-addr">Loading…</div></div></div>
	{:else if addresses.items.length === 0}
		<div class="alias-row"><div class="alias-info"><div class="alias-addr">No addresses yet.</div></div></div>
	{/if}
	{#each addresses.items as a (a.id)}
		<div class="alias-row">
			{#if a.isPrimary}
				<span class="alias-star" title="Primary identity"><Star size={16} /></span>
			{:else}
				<button
					type="button"
					class="alias-star promote"
					title="Make primary"
					onclick={() => promote(a.id)}
				>
					<Star size={16} />
				</button>
			{/if}
			<div class="alias-info">
				{#if editingNameFor === a.id}
					<div class="alias-name editing">
						<input
							class="tin name-edit"
							bind:value={editingNameValue}
							maxlength="120"
							placeholder="Display name (optional)"
							autofocus
							onkeydown={(e) => {
								if (e.key === 'Enter') commitRename(a.id);
								if (e.key === 'Escape') cancelRename();
							}}
						/>
						<button type="button" class="rowmenu" title="Save" onclick={() => commitRename(a.id)}>
							<Check size={15} />
						</button>
						<button type="button" class="rowmenu" title="Cancel" onclick={cancelRename}>
							<X size={15} />
						</button>
					</div>
					{#if renameError}<div class="alias-addr err">{renameError}</div>{/if}
				{:else}
					<div class="alias-name">
						{a.name ?? auth.fullName ?? a.email}
						{#if a.isPrimary}<Badge kind="pine">Primary</Badge>{/if}
						<button
							type="button"
							class="rowmenu small"
							title="Rename"
							onclick={() => startRename(a.id, a.name)}
						>
							<Pencil size={13} />
						</button>
					</div>
				{/if}
				<div class="alias-addr">{a.email}</div>
			</div>
			{#if !a.isPrimary && editingNameFor !== a.id}
				<button
					type="button"
					class="rowmenu"
					title="Remove"
					onclick={() => remove(a.id, a.email)}
				>
					<Trash2 size={16} />
				</button>
			{/if}
		</div>
	{/each}
	<AddRow label="Add an address" onClick={() => launch('address')} />
	{#if addresses.error}
		<div class="alias-row"><div class="alias-info"><div class="alias-addr err">{addresses.error}</div></div></div>
	{/if}
</div>

{#if showCatchAll}
	<CatchAllCard />
{/if}

<style>
	.alias-star.promote {
		background: none;
		border: 0;
		cursor: pointer;
		color: var(--ink-2, rgba(0, 0, 0, 0.4));
	}
	.alias-star.promote:hover {
		color: var(--pine, #2b5f3f);
	}
	.alias-addr.err {
		color: var(--warn, #b25030);
	}
	.alias-name.editing {
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.name-edit {
		width: 240px;
	}
	.rowmenu.small {
		padding: 2px 4px;
	}
</style>
