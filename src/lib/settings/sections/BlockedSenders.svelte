<script lang="ts">
	import UserX from '@lucide/svelte/icons/user-x';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Lock from '@lucide/svelte/icons/lock';
	import Plus from '@lucide/svelte/icons/plus';
	import SecHead from '../SecHead.svelte';
	import CardHead from '../CardHead.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { deleteBlockedSender, listBlockedSenders } from '$lib/api/blockedSenders';
	import { blockSender, unsealAddress } from '$lib/mail/blockedSenders';

	interface Entry {
		id: string;
		createdAt: string;
		address: string | null;
	}

	let entries = $state<Entry[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let adding = $state(false);
	let newAddress = $state('');
	let addBusy = $state(false);
	let addError = $state<string | null>(null);
	let removing = $state<string | null>(null);
	let loadedFor: string | null = null;

	const sealedHidden = $derived(entries.some((e) => e.address === null));

	$effect(() => {
		const accountId = auth.accountId;
		if (!accountId || loadedFor === accountId) return;
		loadedFor = accountId;
		void load(accountId);
	});

	async function load(accountId: string) {
		loading = true;
		error = null;
		try {
			const res = await listBlockedSenders();
			const rows = res.blockedSenders ?? [];
			const opened = await Promise.all(
				rows.map(async (row) => ({
					id: row.id,
					createdAt: row.createdAt,
					address: await unsealAddress(accountId, row.sealedLabel)
				}))
			);
			if (auth.accountId !== accountId) return;
			entries = opened;
		} catch (e) {
			error = e instanceof Error && e.message ? e.message : 'Could not load the block list';
		} finally {
			loading = false;
		}
	}

	async function add() {
		const accountId = auth.accountId;
		const address = newAddress.trim().toLowerCase();
		if (!accountId || !address) return;
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
			addError = 'Enter a full email address.';
			return;
		}
		addBusy = true;
		addError = null;
		try {
			const created = await blockSender(accountId, address);
			entries = [{ id: created.id, createdAt: created.createdAt, address }, ...entries];
			newAddress = '';
			adding = false;
		} catch (e) {
			addError = e instanceof Error && e.message ? e.message : 'Could not block that address';
		} finally {
			addBusy = false;
		}
	}

	async function remove(entry: Entry) {
		const label = entry.address ?? 'this sender';
		if (!confirm(`Unblock ${label}? Their mail will reach your inbox again.`)) return;
		removing = entry.id;
		try {
			await deleteBlockedSender(entry.id);
			entries = entries.filter((e) => e.id !== entry.id);
		} catch (e) {
			error = e instanceof Error && e.message ? e.message : 'Could not unblock';
		} finally {
			removing = null;
		}
	}

	function formatDate(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<SecHead
	tag="Blocked senders"
	title="Blocked senders"
	desc="Mail from a blocked address lands in Spam and raises no notification. The server keeps only a keyed hash of the address, so it cannot read your block list; the label shown here is decrypted in this browser."
/>

<div class="scard">
	<CardHead icon={UserX} title="Block list">
		{#snippet right()}
			<span class="card-meta">{entries.length} blocked</span>
		{/snippet}
	</CardHead>

	{#if sealedHidden}
		<div class="card-note">
			<Lock size={13} />
			<span>
				Some labels were sealed with a key this browser no longer holds. Those entries still block
				mail, and you can remove them by date.
			</span>
		</div>
	{/if}

	{#if error}
		<div class="card-note bs-err" role="alert">
			<Lock size={13} /><span>{error}</span>
		</div>
	{/if}

	{#if loading}
		<div class="alias-row"><div class="alias-info"><div class="alias-addr">Loading…</div></div></div>
	{:else if entries.length === 0}
		<div class="alias-row">
			<div class="alias-info">
				<div class="alias-addr">Nobody is blocked.</div>
				<div class="alias-target">Block a sender from the message menu, or add an address below.</div>
			</div>
		</div>
	{/if}

	{#each entries as e (e.id)}
		<div class="alias-row">
			<div class="alias-info">
				<div class="alias-addr">{e.address ?? 'Address held encrypted'}</div>
				<div class="alias-target">Blocked {formatDate(e.createdAt)}</div>
			</div>
			<button
				type="button"
				class="rowmenu"
				title="Unblock"
				disabled={removing === e.id}
				onclick={() => void remove(e)}
			>
				<Trash2 size={15} />
			</button>
		</div>
	{/each}

	{#if adding}
		<div class="alias-row bs-add">
			<div class="alias-info">
				<input
					class="tin mono"
					type="email"
					placeholder="name@example.com"
					bind:value={newAddress}
					disabled={addBusy}
					onkeydown={(ev) => {
						if (ev.key === 'Enter') void add();
						if (ev.key === 'Escape') {
							adding = false;
							addError = null;
						}
					}}
				/>
				{#if addError}<div class="alias-target bs-adderr">{addError}</div>{/if}
			</div>
			<button type="button" class="btn btn-secondary btn-sm" disabled={addBusy} onclick={() => void add()}>
				Block
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				disabled={addBusy}
				onclick={() => {
					adding = false;
					newAddress = '';
					addError = null;
				}}
			>
				Cancel
			</button>
		</div>
	{:else}
		<button type="button" class="addrow" onclick={() => (adding = true)}>
			<Plus size={16} />Block an address
		</button>
	{/if}
</div>

<style>
	.bs-err span {
		color: var(--danger-700);
	}
	.bs-adderr {
		color: var(--danger-700);
	}
	.bs-add {
		gap: 9px;
	}
</style>
