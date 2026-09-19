<script lang="ts">
	import KeySquare from '@lucide/svelte/icons/key-square';
	import Check from '@lucide/svelte/icons/check';
	import Info from '@lucide/svelte/icons/info';
	import Clock from '@lucide/svelte/icons/clock';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import CeremonyShell from '../CeremonyShell.svelte';
	import ProgressRun from '../ProgressRun.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import type { CeremonyKind } from '../data';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();
	let step = $state(0);
	const steps = $derived([
		m.settings_ceremony_keys_step_rotate(),
		m.settings_ceremony_keys_step_reencrypt(),
		m.settings_ceremony_keys_step_done()
	]);
</script>

<CeremonyShell
	icon={KeySquare}
	eyebrow={m.settings_ceremony_keys_eyebrow()}
	title={m.settings_ceremony_keys_title()}
	{steps}
	{step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>{m.settings_ceremony_keys_lede()}</p>
			</div>
			<ul class="cer-points">
				<li><Check size={16} /><span>{m.settings_ceremony_keys_point_readable()}</span></li>
				<li><Info size={16} /><span>{m.settings_ceremony_keys_point_fingerprint()}</span></li>
				<li><Clock size={16} /><span>{m.settings_ceremony_keys_point_background()}</span></li>
			</ul>
			<div class="field">
				<label for="cur-fp">{m.settings_ceremony_keys_current_fingerprint()}</label>
				<div class="codeblock sm" id="cur-fp"><span class="v">4F2A 9C71 B0E3 5D88</span></div>
			</div>
		</div>
	{:else if step === 1}
		<ProgressRun
			label={m.settings_ceremony_keys_progress()}
			lines={[
				m.settings_ceremony_keys_line_generate(),
				m.settings_ceremony_keys_line_index(),
				m.settings_ceremony_keys_line_mailbox(),
				m.settings_ceremony_keys_line_publish()
			]}
			onDone={() => (step = 2)}
		/>
	{:else}
		<DoneScreen
			icon={KeySquare}
			title={m.settings_ceremony_keys_done_title()}
			desc={m.settings_ceremony_keys_done_desc()}
		>
			<div class="field" style:margin-top="18px">
				<label for="new-fp">{m.settings_ceremony_keys_new_fingerprint()}</label>
				<div class="codeblock sm" id="new-fp"><span class="v">A19F 4B0C 2D71 88AC</span></div>
			</div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" onclick={() => (step = 1)}>
				<RefreshCw size={15} />{m.settings_ceremony_keys_rotate()}
			</Button>
		{:else if step === 2}
			<Button variant="primary" onclick={() => {
					onComplete('keys');
					onClose();
				}}>{m.common_done()}</Button>
		{/if}
	{/snippet}
</CeremonyShell>
