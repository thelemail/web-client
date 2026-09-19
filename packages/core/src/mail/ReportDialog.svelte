<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { submitReport, type ReportOutcome } from './report';
	import type { MessageReportKind } from '$core/api/types';
	import { auth } from '$core/stores/auth.svelte';
	import { accountSettings } from '$core/stores/accountSettings.svelte';

	interface Props {
		messageId: string;
		subject?: string;
		senderAddress?: string;
		onClose: () => void;
		onReported: (kind: MessageReportKind, outcome: ReportOutcome) => void;
	}

	let { messageId, subject = '', senderAddress = '', onClose, onReported }: Props = $props();

	const KINDS: { id: MessageReportKind; label: () => string; hint: () => string }[] = [
		{
			id: 'phishing',
			label: () => m.mail_report_kind_phishing(),
			hint: () => m.mail_report_kind_phishing_hint()
		},
		{ id: 'spam', label: () => m.mail_report_kind_spam(), hint: () => m.mail_report_kind_spam_hint() }
	];

	let kind = $state<MessageReportKind>('phishing');
	let includeHeaders = $state(accountSettings.privacy.shareSpamHeaders === true);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const hint = $derived(KINDS.find((k) => k.id === kind)?.hint() ?? '');

	async function confirm() {
		const accountId = auth.accountId;
		if (!accountId) {
			error = m.mail_report_unlock_required();
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
			error = e instanceof Error && e.message ? e.message : m.mail_report_failed();
		} finally {
			busy = false;
		}
	}
</script>

<ConfirmDialog
	icon={ShieldAlert}
	title={m.mail_report_title()}
	sub={subject}
	tone="danger"
	confirmLabel={m.mail_report_confirm()}
	{busy}
	{error}
	onConfirm={() => void confirm()}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">{m.mail_report_body()}</p>

		<div class="cfd-seg" role="radiogroup" aria-label={m.mail_report_reason_aria()}>
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
					{k.label()}
				</button>
			{/each}
		</div>
		<p class="cfd-hint">{hint}</p>

		<label class="cfd-check">
			<input type="checkbox" bind:checked={includeHeaders} disabled={busy} />
			<span>
				<span class="cfd-check-t">{m.mail_report_include_headers()}</span>
				<span class="cfd-check-d">
					{senderAddress
						? m.mail_report_include_headers_detail_sender({ sender: senderAddress })
						: m.mail_report_include_headers_detail()}
				</span>
			</span>
		</label>
	{/snippet}
</ConfirmDialog>
