<script lang="ts">
	import { platform } from '$platform';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import Check from '@lucide/svelte/icons/check';
	import CeremonyShell from './CeremonyShell.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		codes: string[];
		onClose: () => void;
	}

	let { codes, onClose }: Props = $props();

	let saved = $state(false);

	async function copyCodes() {
		try {
			await navigator.clipboard.writeText(codes.join('\n'));
			saved = true;
		} catch (err) {
			console.warn('twofa: clipboard write failed', err);
		}
	}

	async function downloadCodes() {
		const lines = [
			'Thelemail two-factor backup codes',
			'=================================',
			'',
			`Account:   ${auth.email ?? ''}`,
			`Generated: ${new Date().toISOString().slice(0, 10)}`,
			'',
			'Each code signs you in once if you lose your second factor:',
			'',
			...codes.map((c, i) => `  ${String(i + 1).padStart(2, ' ')}. ${c}`),
			'',
			'Keep these offline. Anyone with a code and your password can sign in.',
			''
		];
		const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
		await platform.saveBlob(blob, 'thelemail-backup-codes.txt');
		saved = true;
	}
</script>

<CeremonyShell
	icon={ShieldCheck}
	eyebrow="Security"
	title="Your new backup codes"
	{onClose}
>
	<div class="cer-pane">
		<div class="cer-instruct">
			Your previous codes no longer work. Save these — each signs you in once.
		</div>
		<div class="backup-grid">
			{#each codes as c, i (i)}
				<div class="bc">
					<span class="bc-n">{i + 1}</span>
					<span class="bc-c">{c}</span>
				</div>
			{/each}
		</div>
		<div class="phrase-acts">
			<Button variant="secondary" size="sm" onclick={copyCodes}>
				<Copy size={14} />Copy
			</Button>
			<Button variant="secondary" size="sm" onclick={downloadCodes}>
				<Download size={14} />Download
			</Button>
			{#if saved}<span class="phrase-saved"><Check size={13} />Saved</span>{/if}
		</div>
	</div>

	{#snippet footer()}
		<Button variant="primary" disabled={!saved} onclick={onClose}>
			I’ve saved them<Check size={15} />
		</Button>
	{/snippet}
</CeremonyShell>
