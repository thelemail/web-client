<script lang="ts">
	import CalendarOff from '@lucide/svelte/icons/calendar-off';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Inbox from '@lucide/svelte/icons/inbox';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import UserPlus from '@lucide/svelte/icons/user-plus';

	import { m } from '$paraglide/messages.js';
	import CeremonyShell from './CeremonyShell.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { Button } from '$core/components/ui/button';

	interface Props {
		name: string;
		email: string;
		accountId: string;
		onClose: () => void;
	}

	let { name, email, accountId, onClose }: Props = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	const firstName = $derived(name.trim().split(/\s+/)[0] || name);

	async function submit() {
		busy = true;
		error = null;
		try {
			await workspaces.removeMember(accountId);
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : m.settings_family_remove_failed();
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell
	icon={UserMinus}
	eyebrow={m.settings_member_title_family()}
	title={m.settings_family_remove_title({ name })}
	tone="danger"
	{onClose}
>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>{m.settings_family_remove_lede()}</p>
		</div>
		<ul class="cer-points">
			<li>
				<Inbox size={16} />
				<span>{m.settings_family_remove_point_free({ email })}</span>
			</li>
			<li>
				<CalendarOff size={16} />
				<span>{m.settings_family_remove_point_calendar()}</span>
			</li>
			<li>
				<UserPlus size={16} />
				<span>{m.settings_family_remove_point_reinvite()}</span>
			</li>
		</ul>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>{m.settings_family_remove_keep()}</Button>
		<Button variant="danger" disabled={busy} onclick={submit}>
			{busy ? m.settings_family_removing() : m.settings_family_remove_submit({ name: firstName })}
		</Button>
	{/snippet}
</CeremonyShell>
