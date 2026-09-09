<script lang="ts">
	import CalendarOff from '@lucide/svelte/icons/calendar-off';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LogOut from '@lucide/svelte/icons/log-out';
	import UserRound from '@lucide/svelte/icons/user-round';

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
			settingsDraft.flash('You have left the family.');
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not leave the family';
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell icon={LogOut} eyebrow="Household" title="Leave {familyName}" tone="danger" {onClose}>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>Your account goes back to being on its own, on the free plan.</p>
		</div>
		<ul class="cer-points">
			<li>
				<Inbox size={16} />
				<span>You keep your address, every message in it, and your keys.</span>
			</li>
			<li>
				<CalendarOff size={16} />
				<span>
					Your own calendars come with you. You lose the family's shared calendar, and anything you
					put in it stays with the family.
				</span>
			</li>
			<li>
				<UserRound size={16} />
				<span>{familyName} no longer sees you. They would have to invite you again.</span>
			</li>
		</ul>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>Stay in the family</Button>
		<Button variant="danger" disabled={busy} onclick={submit}>
			{busy ? 'Leaving…' : 'Leave the family'}
		</Button>
	{/snippet}
</CeremonyShell>
