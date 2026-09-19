<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Users from '@lucide/svelte/icons/users';
	import CeremonyShell from '../CeremonyShell.svelte';
	import type { CeremonyKind } from '../data';
	import { SHARED_DOMAIN } from '../entitlements';
	import { auth } from '$core/stores/auth.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	function suggestedName(): string {
		const first = (auth.fullName ?? '').trim().split(/\s+/)[0];
		return first
			? m.settings_ceremony_family_start_default_name({ first })
			: m.settings_ceremony_family_start_default_name_fallback();
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
			error = err instanceof Error ? err.message : m.settings_ceremony_family_start_error();
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell
	icon={Users}
	eyebrow={m.settings_ceremony_family_eyebrow()}
	title={m.settings_ceremony_family_start_title()}
	{onClose}
>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>{m.settings_ceremony_family_start_lede()}</p>
		</div>

		<div class="field">
			<label for="fam-start-name">{m.settings_ceremony_family_start_name_label()}</label>
			<input
				id="fam-start-name"
				class="tin"
				bind:value={name}
				maxlength="120"
				autocomplete="off"
			/>
			<div class="field-hint">{m.settings_ceremony_family_start_name_hint()}</div>
		</div>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}

		<div class="seat-callout ok">
			<Users size={17} />
			<div>
				<b>{m.settings_ceremony_family_start_callout_title()}</b>
				{m.settings_ceremony_family_start_callout_body({ domain: SHARED_DOMAIN })}
			</div>
		</div>
	</div>

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose} disabled={busy}>{m.common_cancel()}</Button>
		<Button variant="primary" disabled={!ready} onclick={submit}>
			{busy
				? m.settings_ceremony_family_start_creating()
				: m.settings_ceremony_family_start_submit()}<ArrowRight size={15} />
		</Button>
	{/snippet}
</CeremonyShell>
