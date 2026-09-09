<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { submitReport, type ReportOutcome } from './report';
	import type { MessageReportKind } from '$lib/api/types';
	import { auth } from '$lib/stores/auth.svelte';

	interface Props {
		messageId: string;
		subject?: string;
		senderAddress?: string;
		onClose: () => void;
		onReported: (kind: MessageReportKind, outcome: ReportOutcome) => void;
	}

	let { messageId, subject = '', senderAddress = '', onClose, onReported }: Props = $props();

	const KINDS: { id: MessageReportKind; label: string; hint: string }[] = [
		{
			id: 'phishing',
			label: 'Phishing',
			hint: 'It impersonates someone, or tries to get credentials, payments or personal data.'
		},
		{ id: 'spam', label: 'Spam', hint: 'It is unsolicited bulk mail you did not ask for.' }
	];

	let kind = $state<MessageReportKind>('phishing');
	let includeHeaders = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const hint = $derived(KINDS.find((k) => k.id === kind)?.hint ?? '');

	async function confirm() {
		const accountId = auth.accountId;
		if (!accountId) {
			error = 'Unlock this account to report the message.';
			return;
		}
		busy = true;
		error = null;
		try {
			const outcome = await submitReport(accountId, messageId, {
				kind,
				includeHeaders,
				senderAddress: includeHeaders ? senderAddress : undefined
			});
			onReported(kind, outcome);
			onClose();
		} catch (e) {
			error = e instanceof Error && e.message ? e.message : 'The report could not be sent.';
		} finally {
			busy = false;
		}
	}
</script>

<ConfirmDialog
	icon={ShieldAlert}
	title="Report this message"
	sub={subject}
	tone="danger"
	confirmLabel="Report and move to Spam"
	{busy}
	{error}
	onConfirm={() => void confirm()}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">
			We keep a record of the report and move the message to Spam. By default the record holds
			nothing but the message reference and what you picked below.
		</p>

		<div class="cfd-seg" role="radiogroup" aria-label="Report reason">
			{#each KINDS as k (k.id)}
				<button
					type="button"
					class="cfd-segb"
					class:on={kind === k.id}
					role="radio"
					aria-checked={kind === k.id}
					disabled={busy}
					onclick={() => (kind = k.id)}
				>
					{k.label}
				</button>
			{/each}
		</div>
		<p class="cfd-hint">{hint}</p>

		<label class="cfd-check">
			<input type="checkbox" bind:checked={includeHeaders} disabled={busy} />
			<span>
				<span class="cfd-check-t">Include the message headers</span>
				<span class="cfd-check-d">
					Attaches the decrypted header block{senderAddress ? ` and ${senderAddress}` : ''} to the
					report so we can trace how the message was routed. Off by default. Nothing leaves your
					browser unless you tick this.
				</span>
			</span>
		</label>
	{/snippet}
</ConfirmDialog>
