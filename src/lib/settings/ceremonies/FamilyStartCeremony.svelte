<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Users from '@lucide/svelte/icons/users';
	import CeremonyShell from '../CeremonyShell.svelte';
	import type { CeremonyKind } from '../data';
	import { SHARED_DOMAIN } from '../entitlements';
	import { auth } from '$lib/stores/auth.svelte';
	import { billing } from '$lib/stores/billing.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	function suggestedName(): string {
		const first = (auth.fullName ?? '').trim().split(/\s+/)[0];
		return first ? `${first}'s family` : 'My family';
	}

	let name = $state(suggestedName());
	let busy = $state(false);
	let error = $state<string | null>(null);

	const ready = $derived(name.trim().length > 0 && name.trim().length <= 120 && !busy);

	async function submit() {
		if (!ready) return;
		busy = true;
		error = null;
		try {
			await workspaces.changeType({ type: 'family', name: name.trim() });
			await billing.refresh();
			if (auth.accountId) await workspaces.load(auth.accountId);
			onComplete('family');
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not start the family';
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell icon={Users} eyebrow="Household" title="Start a family" {onClose}>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>
				Your account becomes the first of up to six in one family. Nothing about your mailbox
				changes.
			</p>
		</div>

		<div class="field">
			<label for="fam-start-name">Family name</label>
			<input
				id="fam-start-name"
				class="tin"
				bind:value={name}
				maxlength="120"
				autocomplete="off"
			/>
			<div class="field-hint">Only people in the family see this.</div>
		</div>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}

		<div class="seat-callout ok">
			<Users size={17} />
			<div>
				<b>Free family: 6 accounts, 1 GB of storage each.</b>
				Everyone you invite already needs a {SHARED_DOMAIN} account. No custom domains, and
				everything you have stays where it is.
			</div>
		</div>
	</div>

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>Cancel</Button>
		<Button variant="primary" disabled={!ready} onclick={submit}>
			{busy ? 'Creating…' : 'Create the family'}<ArrowRight size={15} />
		</Button>
	{/snippet}
</CeremonyShell>
