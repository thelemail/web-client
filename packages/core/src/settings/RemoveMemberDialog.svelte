<script lang="ts">
	import CalendarOff from '@lucide/svelte/icons/calendar-off';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Inbox from '@lucide/svelte/icons/inbox';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import UserPlus from '@lucide/svelte/icons/user-plus';

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
			error = err instanceof Error ? err.message : 'Could not remove this person';
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell
	icon={UserMinus}
	eyebrow="Household"
	title="Remove {name} from the family"
	tone="danger"
	{onClose}
>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>They keep their address and everything in their mailbox.</p>
		</div>
		<ul class="cer-points">
			<li>
				<Inbox size={16} />
				<span>{email} goes back to being a free account of its own.</span>
			</li>
			<li>
				<CalendarOff size={16} />
				<span>They lose the family's shared calendar. Their own calendars go with them.</span>
			</li>
			<li>
				<UserPlus size={16} />
				<span>You can invite them again later.</span>
			</li>
		</ul>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>Keep them in the family</Button>
		<Button variant="danger" disabled={busy} onclick={submit}>
			{busy ? 'Removing…' : `Remove ${firstName}`}
		</Button>
	{/snippet}
</CeremonyShell>
