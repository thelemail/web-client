<script lang="ts">
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import CopyBtn from './CopyBtn.svelte';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import UserRound from '@lucide/svelte/icons/user-round';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import X from '@lucide/svelte/icons/x';
	import { m } from '$paraglide/messages.js';
	import type { AccountMember } from './types';
	import { memberRoleLabel } from './memberRole';
	import { Button } from '$core/components/ui/button';

	export type MemberRowAction =
		| { kind: 'promote' }
		| { kind: 'demote' }
		| { kind: 'remove' }
		| { kind: 'revoke' }
		| { kind: 'resend' };

	export type MemberRowFeedback = { kind: 'error' | 'notice'; text: string; link?: string };

	interface Props {
		m: AccountMember;
		canPromote?: boolean;
		canDemote?: boolean;
		canRemove?: boolean;
		canRevoke?: boolean;
		canResend?: boolean;
		busy?: boolean;
		feedback?: MemberRowFeedback | null;
		onDismiss?: () => void;
		onAction?: (a: MemberRowAction) => boolean | Promise<boolean>;
	}

	let {
		m: member,
		canPromote = false,
		canDemote = false,
		canRemove = false,
		canRevoke = false,
		canResend = false,
		busy = false,
		feedback = null,
		onDismiss,
		onAction
	}: Props = $props();

	let menuOpen = $state(false);
	let mode = $state<'idle' | 'confirm-remove' | 'confirm-revoke'>('idle');

	const hasActions = $derived(
		Boolean(onAction) &&
			(canPromote || canDemote || canRemove || canRevoke || canResend)
	);

	const roleLabel = $derived(memberRoleLabel(member.role));

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	async function resend() {
		if (!canResend || !onAction) return;
		menuOpen = false;
		await onAction({ kind: 'resend' });
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

<div class="mbr-row" class:pending={member.pending}>
	<span class="mbr-av" style:background={member.bg} style:color={member.fg}>{member.init}</span>
	<div class="mbr-info">
		<div class="mbr-name">
			{member.name}{#if member.pending}<span class="mbr-flag">{m.settings_member_invited()}</span>{/if}
		</div>
		<div class="mbr-addr">{member.addr}</div>
	</div>
	<span class={'mbr-role r-' + member.role.toLowerCase()}>{roleLabel}</span>
	{#if hasActions}
		<div class="mbr-actions">
			{#if mode === 'idle'}
				<button
					type="button"
					class="mbr-act-btn"
					aria-label={m.settings_member_actions()}
					onclick={toggleMenu}
					disabled={busy}
				>
					<EllipsisVertical size={16} strokeWidth={1.75} />
				</button>
				{#if menuOpen}
					<div class="mbr-menu" role="menu">
						{#if canResend}
							<button type="button" class="mbr-menu-item" onclick={resend}>
								<Copy size={14} strokeWidth={1.75} />{m.settings_member_resend()}
							</button>
						{/if}
						{#if canPromote}
							<button type="button" class="mbr-menu-item" onclick={doPromote}>
								<ShieldCheck size={14} strokeWidth={1.75} />{m.settings_member_make_admin()}
							</button>
						{/if}
						{#if canDemote}
							<button type="button" class="mbr-menu-item" onclick={doDemote}>
								<UserRound size={14} strokeWidth={1.75} />{m.settings_member_make_member()}
							</button>
						{/if}
						{#if canRevoke}
							<button type="button" class="mbr-menu-item danger" onclick={startRevoke}>
								<Trash2 size={14} strokeWidth={1.75} />{m.settings_member_revoke_invite()}
							</button>
						{/if}
						{#if canRemove}
							<button type="button" class="mbr-menu-item danger" onclick={startRemove}>
								<Trash2 size={14} strokeWidth={1.75} />{m.settings_member_remove_from_workspace()}
							</button>
						{/if}
					</div>
				{/if}
			{:else if mode === 'confirm-remove'}
				<span class="mbr-confirm">{m.settings_member_remove_confirm({ name: member.name })}</span>
				<Button variant="secondary" size="sm" onclick={cancel} disabled={busy}>{m.common_cancel()}</Button>
				<Button variant="dangerSolid" size="sm" onclick={confirmRemove} disabled={busy}>{m.common_remove()}</Button>
			{:else if mode === 'confirm-revoke'}
				<span class="mbr-confirm">{m.settings_member_revoke_confirm({ email: member.addr })}</span>
				<Button variant="secondary" size="sm" onclick={cancel} disabled={busy}>{m.common_cancel()}</Button>
				<Button variant="dangerSolid" size="sm" onclick={confirmRevoke} disabled={busy}>{m.settings_member_revoke()}</Button>
			{/if}
		</div>
	{/if}
</div>
{#if feedback}
	<div class="mbr-feedback" class:err={feedback.kind === 'error'} role={feedback.kind === 'error' ? 'alert' : 'status'}>
		{#if feedback.kind === 'error'}<CircleAlert size={14} />{:else if feedback.link}<Info size={14} />{:else}<Check size={14} />{/if}
		<div class="mbr-fb-body">
			<span>{feedback.text}</span>
			{#if feedback.link}
				<span class="mbr-fb-link"><span class="mono">{feedback.link}</span><CopyBtn text={feedback.link} small /></span>
			{/if}
		</div>
		{#if onDismiss}
			<button type="button" class="mbr-fb-x" aria-label={m.settings_member_dismiss()} onclick={onDismiss}>
				<X size={14} />
			</button>
		{/if}
	</div>
{/if}

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
		border-radius: var(--radius-control-compact);
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
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-menu);
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
		border-radius: var(--radius-control-compact);
		color: var(--ink-700);
		cursor: pointer;
	}
	.mbr-menu-item:hover {
		background: var(--paper-200);
	}
	.mbr-menu-item.danger {
		color: var(--danger-700);
	}
	.mbr-feedback {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--border);
		background: var(--paper-50);
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ink-700);
	}
	.mbr-feedback :global(svg) {
		flex: 0 0 auto;
		margin-top: 2px;
		color: var(--success-700);
	}
	.mbr-feedback.err {
		background: color-mix(in oklab, var(--danger-100) 45%, transparent);
		color: var(--danger-700);
	}
	.mbr-feedback.err :global(svg) {
		color: var(--danger-500);
	}
	.mbr-fb-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mbr-fb-link {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.mbr-fb-link .mono {
		font-family: var(--font-mono);
		font-size: 12px;
		overflow-wrap: anywhere;
		user-select: all;
	}
	.mbr-fb-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius-control-compact);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.mbr-fb-x:hover {
		background: var(--paper-200);
	}
	.mbr-fb-x :global(svg) {
		margin: 0;
		color: inherit;
	}
	.mbr-confirm {
		font-size: 13px;
		color: var(--ink-700);
	}
</style>
