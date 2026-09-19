<script lang="ts">
	import UserX from '@lucide/svelte/icons/user-x';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Lock from '@lucide/svelte/icons/lock';
	import Plus from '@lucide/svelte/icons/plus';
	import SecHead from '../SecHead.svelte';
	import CardHead from '../CardHead.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { deleteBlockedSender, listBlockedSenders } from '$core/api/blockedSenders';
	import { blockSender, unsealAddress } from '$core/mail/blockedSenders';
	import { Button } from '$core/components/ui/button';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { m } from '$paraglide/messages.js';

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
	let pendingUnblock = $state<Entry | null>(null);
	let unblockError = $state<string | null>(null);
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
			error = e instanceof Error && e.message ? e.message : m.settings_blocked_load_failed();
		} finally {
			loading = false;
		}
	}

	async function add() {
		const accountId = auth.accountId;
		const address = newAddress.trim().toLowerCase();
		if (!accountId || !address) return;
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
			addError = m.settings_blocked_invalid_address();
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
			addError = e instanceof Error && e.message ? e.message : m.settings_blocked_block_failed();
		} finally {
			addBusy = false;
		}
	}

	function remove(entry: Entry) {
		unblockError = null;
		pendingUnblock = entry;
	}

	async function confirmUnblock() {
		const entry = pendingUnblock;
		if (!entry || removing) return;
		removing = entry.id;
		unblockError = null;
		try {
			await deleteBlockedSender(entry.id);
			entries = entries.filter((e) => e.id !== entry.id);
			pendingUnblock = null;
		} catch (e) {
			unblockError = e instanceof Error && e.message ? e.message : m.settings_blocked_unblock_failed();
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

<SecHead desc={m.settings_blocked_desc()} />

<div class="scard">
	<CardHead icon={UserX} title={m.settings_blocked_title()}>
		{#snippet right()}
			<span class="card-meta">{m.settings_blocked_count({ count: entries.length })}</span>
		{/snippet}
	</CardHead>

	{#if sealedHidden}
		<div class="card-note">
			<Lock size={13} />
			<span>
				{m.settings_blocked_sealed_note()}
			</span>
		</div>
	{/if}

	{#if error}
		<div class="card-note bs-err" role="alert">
			<Lock size={13} /><span>{error}</span>
		</div>
	{/if}

	{#if loading}
		<div class="alias-row"><div class="alias-info"><div class="alias-addr">{m.common_loading()}</div></div></div>
	{:else if entries.length === 0}
		<div class="alias-row">
			<div class="alias-info">
				<div class="alias-addr">{m.settings_blocked_empty()}</div>
				<div class="alias-target">{m.settings_blocked_empty_desc()}</div>
			</div>
		</div>
	{/if}

	{#each entries as e (e.id)}
		<div class="alias-row">
			<div class="alias-info">
				<div class="alias-addr">{e.address ?? m.settings_blocked_address_encrypted()}</div>
				<div class="alias-target">{m.settings_blocked_on({ date: formatDate(e.createdAt) })}</div>
			</div>
			<button
				type="button"
				class="rowmenu"
				title={m.settings_blocked_unblock()}
				disabled={removing === e.id}
				onclick={() => remove(e)}
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
			<Button variant="secondary" size="sm" disabled={addBusy} onclick={() => void add()}>
				{m.settings_blocked_block()}
			</Button>
			<Button variant="ghost" size="sm" disabled={addBusy} onclick={() => {
					adding = false;
					newAddress = '';
					addError = null;
				}}>
				{m.common_cancel()}
			</Button>
		</div>
	{:else}
		<button type="button" class="addrow" onclick={() => (adding = true)}>
			<Plus size={16} />{m.settings_blocked_add()}
		</button>
	{/if}
</div>

{#snippet unblockBody()}
	<p class="cfd-p">{m.settings_blocked_unblock_body()}</p>
{/snippet}

{#if pendingUnblock}
	<ConfirmDialog
		icon={UserX}
		title={m.settings_blocked_unblock_title()}
		sub={pendingUnblock.address ?? m.settings_blocked_sealed_address()}
		confirmLabel={m.settings_blocked_unblock()}
		busy={removing !== null}
		error={unblockError}
		body={unblockBody}
		onConfirm={() => void confirmUnblock()}
		onClose={() => {
			if (removing === null) pendingUnblock = null;
		}}
	/>
{/if}

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
