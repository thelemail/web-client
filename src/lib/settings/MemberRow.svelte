<script lang="ts">
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import UserRound from '@lucide/svelte/icons/user-round';
	import type { AccountMember } from './types';

	export type MemberRowAction =
		| { kind: 'promote' }
		| { kind: 'demote' }
		| { kind: 'remove' }
		| { kind: 'revoke' }
		| { kind: 'copy-link' };

	interface Props {
		m: AccountMember;
		canPromote?: boolean;
		canDemote?: boolean;
		canRemove?: boolean;
		canRevoke?: boolean;
		inviteUrl?: string | null;
		busy?: boolean;
		onAction?: (a: MemberRowAction) => void | Promise<void>;
	}

	let {
		m,
		canPromote = false,
		canDemote = false,
		canRemove = false,
		canRevoke = false,
		inviteUrl = null,
		busy = false,
		onAction
	}: Props = $props();

	let menuOpen = $state(false);
	let mode = $state<'idle' | 'confirm-remove' | 'confirm-revoke'>('idle');
	let copied = $state(false);

	const hasActions = $derived(
		Boolean(onAction) &&
			(canPromote || canDemote || canRemove || canRevoke || Boolean(inviteUrl))
	);

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	async function copyLink() {
		if (!inviteUrl) return;
		try {
			await navigator.clipboard.writeText(inviteUrl);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
		menuOpen = false;
	}

	function startRemove() {
		menuOpen = false;
		mode = 'confirm-remove';
	}

	function startRevoke() {
		menuOpen = false;
		mode = 'confirm-revoke';
	}

	function cancel() {
		mode = 'idle';
	}

	async function confirmRemove() {
		if (!onAction) return;
		await onAction({ kind: 'remove' });
		mode = 'idle';
	}

	async function confirmRevoke() {
		if (!onAction) return;
		await onAction({ kind: 'revoke' });
		mode = 'idle';
	}

	async function doPromote() {
		menuOpen = false;
		if (onAction) await onAction({ kind: 'promote' });
	}

	async function doDemote() {
		menuOpen = false;
		if (onAction) await onAction({ kind: 'demote' });
	}
</script>

<div class="mbr-row" class:pending={m.pending}>
	<span class="mbr-av" style:background={m.bg} style:color={m.fg}>{m.init}</span>
	<div class="mbr-info">
		<div class="mbr-name">
			{m.name}{#if m.pending}<span class="mbr-flag">Invited</span>{/if}
		</div>
		<div class="mbr-addr">{m.addr}</div>
	</div>
	<span class={'mbr-role r-' + m.role.toLowerCase()}>{m.role}</span>
	{#if hasActions}
		<div class="mbr-actions">
			{#if mode === 'idle'}
				<button
					type="button"
					class="mbr-act-btn"
					aria-label="Actions"
					onclick={toggleMenu}
					disabled={busy}
				>
					<EllipsisVertical size={16} strokeWidth={1.75} />
				</button>
				{#if menuOpen}
					<div class="mbr-menu" role="menu">
						{#if inviteUrl}
							<button type="button" class="mbr-menu-item" onclick={copyLink}>
								{#if copied}
									<Check size={14} strokeWidth={1.75} />Copied
								{:else}
									<Copy size={14} strokeWidth={1.75} />Copy invitation link
								{/if}
							</button>
						{/if}
						{#if canPromote}
							<button type="button" class="mbr-menu-item" onclick={doPromote}>
								<ShieldCheck size={14} strokeWidth={1.75} />Make admin
							</button>
						{/if}
						{#if canDemote}
							<button type="button" class="mbr-menu-item" onclick={doDemote}>
								<UserRound size={14} strokeWidth={1.75} />Change to member
							</button>
						{/if}
						{#if canRevoke}
							<button type="button" class="mbr-menu-item danger" onclick={startRevoke}>
								<Trash2 size={14} strokeWidth={1.75} />Revoke invitation
							</button>
						{/if}
						{#if canRemove}
							<button type="button" class="mbr-menu-item danger" onclick={startRemove}>
								<Trash2 size={14} strokeWidth={1.75} />Remove from workspace
							</button>
						{/if}
					</div>
				{/if}
			{:else if mode === 'confirm-remove'}
				<span class="mbr-confirm">Remove {m.name}?</span>
				<button class="btn btn-secondary btn-sm" onclick={cancel} disabled={busy}>Cancel</button>
				<button class="btn btn-danger btn-sm" onclick={confirmRemove} disabled={busy}>Remove</button>
			{:else if mode === 'confirm-revoke'}
				<span class="mbr-confirm">Revoke invitation for {m.addr}?</span>
				<button class="btn btn-secondary btn-sm" onclick={cancel} disabled={busy}>Cancel</button>
				<button class="btn btn-danger btn-sm" onclick={confirmRevoke} disabled={busy}>Revoke</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.mbr-actions {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-left: 8px;
	}
	.mbr-act-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-600);
		cursor: pointer;
	}
	.mbr-act-btn:hover {
		background: var(--paper-200);
	}
	.mbr-menu {
		position: absolute;
		right: 0;
		top: 32px;
		z-index: 40;
		display: flex;
		flex-direction: column;
		min-width: 200px;
		padding: 4px;
		background: var(--paper-0);
		border: 1px solid var(--paper-300);
		border-radius: 8px;
		box-shadow:
			0 4px 16px rgba(0, 0, 0, 0.08),
			0 0 0 1px rgba(0, 0, 0, 0.02);
	}
	.mbr-menu-item {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		font-size: 13px;
		text-align: left;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--ink-700);
		cursor: pointer;
	}
	.mbr-menu-item:hover {
		background: var(--paper-200);
	}
	.mbr-menu-item.danger {
		color: var(--danger-600, #b91c1c);
	}
	.mbr-confirm {
		font-size: 13px;
		color: var(--ink-700);
	}
	.btn-danger {
		background: var(--danger-600, #b91c1c);
		color: white;
		border: 1px solid var(--danger-700, #991b1b);
	}
	.btn-danger:disabled {
		opacity: 0.6;
	}
</style>
