<script lang="ts">
	import CalendarOff from '@lucide/svelte/icons/calendar-off';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LogOut from '@lucide/svelte/icons/log-out';
	import UserRound from '@lucide/svelte/icons/user-round';

	import { m } from '$paraglide/messages.js';
	import CeremonyShell from './CeremonyShell.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { reloadWorkspaceData } from '$core/stores/accountData';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
	import { Button } from '$core/components/ui/button';

	interface Props {
		familyName: string;
		onClose: () => void;
	}

	let { familyName, onClose }: Props = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	async function submit() {
		busy = true;
		error = null;
		try {
			await workspaces.leave();
			if (auth.accountId) await reloadWorkspaceData(auth.accountId);
			settingsDraft.flash(m.settings_family_left());
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : m.settings_family_leave_failed();
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell icon={LogOut} eyebrow={m.settings_member_title_family()} title={m.settings_family_leave_title({ family: familyName })} tone="danger" {onClose}>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>{m.settings_family_leave_lede()}</p>
		</div>
		<ul class="cer-points">
			<li>
				<Inbox size={16} />
				<span>{m.settings_family_leave_point_keep()}</span>
			</li>
			<li>
				<CalendarOff size={16} />
				<span>{m.settings_family_leave_point_calendar()}</span>
			</li>
			<li>
				<UserRound size={16} />
				<span>{m.settings_family_leave_point_unseen({ family: familyName })}</span>
			</li>
		</ul>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>{m.settings_family_leave_stay()}</Button>
		<Button variant="danger" disabled={busy} onclick={submit}>
			{busy ? m.settings_family_leaving() : m.settings_family_leave_submit()}
		</Button>
	{/snippet}
</CeremonyShell>
