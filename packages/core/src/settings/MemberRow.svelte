<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faCheck,
		faCircleExclamation,
		faCircleInfo,
		faCopy,
		faEllipsisVertical,
		faShieldCheck,
		faTrashCan,
		faUser,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import CopyBtn from './CopyBtn.svelte';
	import { m } from '$paraglide/messages.js';
	import type { AccountMember } from './types';
	import { memberRoleLabel } from './memberRole';
	import { Button } from '$core/components/ui/button';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';

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

	let mode = $state<'idle' | 'confirm-remove' | 'confirm-revoke'>('idle');

	const hasActions = $derived(
		Boolean(onAction) &&
			(canPromote || canDemote || canRemove || canRevoke || canResend)
	);

	const roleLabel = $derived(memberRoleLabel(member.role));

	async function resend() {
		if (!canResend || !onAction) return;
		await onAction({ kind: 'resend' });
	}

	function startRemove() {
		mode = 'confirm-remove';
	}

	function startRevoke() {
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
		if (onAction) await onAction({ kind: 'promote' });
	}

	async function doDemote() {
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
				<DropdownMenu.Root>
					<DropdownMenu.Trigger disabled={busy}>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-sm" aria-label={m.settings_member_actions()}>
								<Icon icon={faEllipsisVertical} size={16} />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						{#if canResend}
							<DropdownMenu.Item onSelect={resend}>
								<Icon icon={faCopy} size={14} />{m.settings_member_resend()}
							</DropdownMenu.Item>
						{/if}
						{#if canPromote}
							<DropdownMenu.Item onSelect={doPromote}>
								<Icon icon={faShieldCheck} size={14} />{m.settings_member_make_admin()}
							</DropdownMenu.Item>
						{/if}
						{#if canDemote}
							<DropdownMenu.Item onSelect={doDemote}>
								<Icon icon={faUser} size={14} />{m.settings_member_make_member()}
							</DropdownMenu.Item>
						{/if}
						{#if canRevoke}
							<DropdownMenu.Item variant="danger" onSelect={startRevoke}>
								<Icon icon={faTrashCan} size={14} />{m.settings_member_revoke_invite()}
							</DropdownMenu.Item>
						{/if}
						{#if canRemove}
							<DropdownMenu.Item variant="danger" onSelect={startRemove}>
								<Icon icon={faTrashCan} size={14} />{m.settings_member_remove_from_workspace()}
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else if mode === 'confirm-remove'}
				<span class="mbr-confirm">{m.settings_member_remove_confirm({ name: member.name })}</span>
				<Button variant="neutral" size="sm" onclick={cancel} disabled={busy}>{m.common_cancel()}</Button>
				<Button variant="dangerSolid" size="sm" onclick={confirmRemove} disabled={busy}>{m.common_remove()}</Button>
			{:else if mode === 'confirm-revoke'}
				<span class="mbr-confirm">{m.settings_member_revoke_confirm({ email: member.addr })}</span>
				<Button variant="neutral" size="sm" onclick={cancel} disabled={busy}>{m.common_cancel()}</Button>
				<Button variant="dangerSolid" size="sm" onclick={confirmRevoke} disabled={busy}>{m.settings_member_revoke()}</Button>
			{/if}
		</div>
	{/if}
</div>
{#if feedback}
	<div class="mbr-feedback" class:err={feedback.kind === 'error'} role={feedback.kind === 'error' ? 'alert' : 'status'}>
		{#if feedback.kind === 'error'}<Icon icon={faCircleExclamation} size={14} />{:else if feedback.link}<Icon icon={faCircleInfo} size={14} />{:else}<Icon icon={faCheck} size={14} />{/if}
		<div class="mbr-fb-body">
			<span>{feedback.text}</span>
			{#if feedback.link}
				<span class="mbr-fb-link"><span class="mono">{feedback.link}</span><CopyBtn text={feedback.link} small /></span>
			{/if}
		</div>
		{#if onDismiss}
			<Button variant="ghost" size="icon-xs" aria-label={m.settings_member_dismiss()} onclick={onDismiss}>
				<Icon icon={faXmark} size={14} />
			</Button>
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
	.mbr-feedback {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-raised);
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--fg);
	}
	.mbr-feedback > :global(svg) {
		flex: 0 0 auto;
		margin-top: 2px;
		color: var(--success-700);
	}
	.mbr-feedback.err {
		background: color-mix(in oklab, var(--danger-100) 45%, transparent);
		color: var(--danger-700);
	}
	.mbr-feedback.err > :global(svg) {
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
	.mbr-confirm {
		font-size: 13px;
		color: var(--fg);
	}
</style>
