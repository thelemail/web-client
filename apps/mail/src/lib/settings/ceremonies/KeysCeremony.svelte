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
	import { Button } from '$lib/components/ui/button';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();
	let step = $state(0);
	const steps = ['Rotate', 'Re-encrypt', 'Done'];
</script>

<CeremonyShell
	icon={KeySquare}
	eyebrow="Encryption · ceremony"
	title="Rotate your key"
	{steps}
	{step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					Rotating issues a fresh keypair and re-encrypts your archive to it. Useful if you suspect
					your key is exposed.
				</p>
			</div>
			<ul class="cer-points">
				<li><Check size={16} /><span>Existing mail stays readable — it’s re-encrypted, not lost.</span></li>
				<li><Info size={16} /><span>Your fingerprint changes. Verified contacts will need to re-pin it.</span></li>
				<li><Clock size={16} /><span>Re-encryption runs in the background and can take a few minutes.</span></li>
			</ul>
			<div class="field">
				<label for="cur-fp">Current fingerprint</label>
				<div class="codeblock sm" id="cur-fp"><span class="v">4F2A 9C71 B0E3 5D88</span></div>
			</div>
		</div>
	{:else if step === 1}
		<ProgressRun
			label="Rotating your key…"
			lines={[
				'Generating new keypair',
				'Re-encrypting archive index',
				'Re-encrypting mailbox',
				'Publishing new public key'
			]}
			onDone={() => (step = 2)}
		/>
	{:else}
		<DoneScreen
			icon={KeySquare}
			title="Key rotated"
			desc="Your archive is now encrypted to a new key."
		>
			<div class="field" style:margin-top="18px">
				<label for="new-fp">New fingerprint</label>
				<div class="codeblock sm" id="new-fp"><span class="v">A19F 4B0C 2D71 88AC</span></div>
			</div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose}>Cancel</Button>
			<Button variant="primary" onclick={() => (step = 1)}>
				<RefreshCw size={15} />Rotate key
			</Button>
		{:else if step === 2}
			<Button variant="primary" onclick={() => {
					onComplete('keys');
					onClose();
				}}>Done</Button>
		{/if}
	{/snippet}
</CeremonyShell>
