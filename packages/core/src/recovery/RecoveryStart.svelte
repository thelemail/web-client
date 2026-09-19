<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { platform } from '$platform';
	import Eye from '@lucide/svelte/icons/eye';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import Printer from '@lucide/svelte/icons/printer';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import Avatar from '$core/components/Avatar.svelte';
	import { Button } from '$core/components/ui/button';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { initialsFor } from '$core/mail/initials';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import {
		commitRecovery,
		prepareRecovery,
		RecoveryVaultLockedError,
		type RecoveryMaterial
	} from './setup';
	import { RECOVERY_KIT_FILENAME, recoveryKitBlob } from './kit';
	import { m } from '$paraglide/messages.js';

	interface Props {
		accountId: string;
		returnTo: string;
	}

	let { accountId, returnTo }: Props = $props();

	type Way = 'pdf' | 'copy' | 'print';

	let material = $state<RecoveryMaterial | null>(null);
	let generating = $state(false);
	let generateError = $state('');
	let revealed = $state(false);
	let ack = $state(false);
	let saved = $state<Record<Way, boolean>>({ pdf: false, copy: false, print: false });
	let saveError = $state('');
	let submitting = $state(false);
	let submitError = $state('');

	const email = $derived(
		accounts.list.find((a) => a.accountId === accountId)?.email ?? auth.email ?? ''
	);
	const initials = $derived(initialsFor(auth.fullNameFor(accountId), email));
	const words = $derived(material?.phrase ?? Array.from({ length: 12 }, () => ''));
	const canPrint = !platform.transport;
	const savedCount = $derived(Object.values(saved).filter(Boolean).length);
	const anySaved = $derived(savedCount > 0);
	const canFinish = $derived(!!material && revealed && ack && anySaved && !submitting);

	const ways = $derived(
		[
			{
				key: 'pdf' as const,
				icon: Download,
				title: m.recovery_start_way_pdf(),
				sub: m.recovery_start_way_pdf_sub(),
				run: downloadPdf
			},
			{
				key: 'copy' as const,
				icon: Copy,
				title: m.recovery_start_way_copy(),
				sub: m.recovery_start_way_copy_sub(),
				run: copyPhrase
			},
			...(canPrint
				? [
						{
							key: 'print' as const,
							icon: Printer,
							title: m.recovery_start_way_print(),
							sub: m.recovery_start_way_print_sub(),
							run: printPhrase
						}
					]
				: [])
		]
	);

	const printSections = $derived([
		{ heading: m.recovery_kit_what_heading(), body: m.recovery_kit_what_body() },
		{ heading: m.recovery_kit_keep_heading(), body: m.recovery_kit_keep_body() },
		{ heading: m.recovery_kit_new_heading(), body: m.recovery_kit_new_body() }
	]);

	async function generate() {
		if (generating) return;
		generating = true;
		generateError = '';
		try {
			material = await prepareRecovery(accountId);
		} catch (err) {
			console.warn('recovery: generate failed', err);
			generateError =
				err instanceof RecoveryVaultLockedError
					? m.settings_ceremony_recovery_err_locked()
					: m.settings_ceremony_recovery_err_generate();
		} finally {
			generating = false;
		}
	}

	onMount(() => {
		void generate();
	});

	async function downloadPdf() {
		if (!material) return;
		saveError = '';
		try {
			await platform.saveBlob(recoveryKitBlob(material.phrase, email), RECOVERY_KIT_FILENAME);
			saved.pdf = true;
		} catch (err) {
			console.warn('recovery: kit download failed', err);
			saveError = m.recovery_start_save_failed();
		}
	}

	async function copyPhrase() {
		if (!material) return;
		saveError = '';
		try {
			await navigator.clipboard.writeText(material.phrase.join(' '));
			saved.copy = true;
		} catch (err) {
			console.warn('recovery: clipboard write failed', err);
			saveError = m.recovery_start_copy_failed();
		}
	}

	function printPhrase() {
		if (!material) return;
		saveError = '';
		window.print();
		saved.print = true;
	}

	async function finish() {
		if (!canFinish || !material) return;
		submitting = true;
		submitError = '';
		try {
			await commitRecovery(material, accountId);
		} catch (err) {
			console.warn('recovery: setup failed', err);
			submitError = m.settings_ceremony_recovery_err_save();
			submitting = false;
			return;
		}
		auth.markRecoveryEnabled(accountId);
		void auth.loadProfile(accountId);
		await goto(returnTo);
	}
</script>

<AuthShell strip={false}>
	<div class="rk-card rk-screen">
		<header class="rk-head">
			<div class="rk-head-tx">
				<p class="rk-eyebrow">{m.recovery_start_eyebrow()}</p>
				<h1>{m.recovery_start_title()}</h1>
				<p class="rk-lede">{m.recovery_start_lede()}</p>
			</div>
			<div class="rk-acct">
				<Avatar {initials} size={28} />
				<span class="mono">{email}</span>
			</div>
		</header>

		<div class="rk-grid">
			<section class="rk-col">
				<div class="rk-label-row">
					<span class="rk-label">{m.recovery_start_phrase_label()}</span>
					<span class="rk-meta mono">{m.recovery_start_phrase_meta()}</span>
				</div>

				<div class="rk-words">
					{#each words as w, i (i)}
						<div class="rk-word">
							<span class="rk-n mono">{i + 1}</span>
							<span class="rk-w mono">{revealed && w ? w : '•••••'}</span>
						</div>
					{/each}
					{#if !revealed}
						<button
							type="button"
							class="rk-cover"
							disabled={!material}
							onclick={() => (revealed = true)}
						>
							{#if material}
								<Eye size={18} />
								<span>{m.settings_ceremony_recovery_reveal()}</span>
								<span class="rk-cover-sub">{m.settings_ceremony_recovery_reveal_sub()}</span>
							{:else if generateError}
								<span class="rk-cover-sub">{generateError}</span>
							{:else}
								<span class="rk-cover-sub">{m.settings_ceremony_recovery_generating()}</span>
							{/if}
						</button>
					{/if}
				</div>

				{#if generateError}
					<Button variant="secondary" size="sm" disabled={generating} onclick={generate}>
						<RotateCw size={14} />{m.recovery_start_retry()}
					</Button>
				{/if}

				<p class="rk-note">{m.recovery_start_phrase_note()}</p>
			</section>

			<section class="rk-col">
				<div class="rk-label-row">
					<span class="rk-label">{m.recovery_start_keep_label()}</span>
					{#if anySaved}
						<span class="rk-saved">
							<Check size={13} />
							{savedCount > 1
								? m.recovery_start_saved_n({ count: savedCount })
								: m.settings_ceremony_recovery_saved()}
						</span>
					{/if}
				</div>

				<div class="rk-ways">
					{#each ways as way (way.key)}
						<button type="button" class="rk-way" disabled={!revealed} onclick={way.run}>
							<span class="rk-way-ic"><way.icon size={16} /></span>
							<span class="rk-way-tx">
								<b>{way.title}</b>
								<span>{way.sub}</span>
							</span>
							{#if saved[way.key]}
								<span class="rk-way-done"><Check size={13} /></span>
							{:else}
								<span class="rk-way-go"><ChevronRight size={16} /></span>
							{/if}
						</button>
					{/each}
				</div>

				{#if saveError}
					<span class="rk-err"><CircleAlert size={13} /><span>{saveError}</span></span>
				{/if}

				<div class="rk-ack">
					<Checkbox id="rk-ack" bind:checked={ack} />
					<label for="rk-ack">{m.recovery_start_ack()}</label>
				</div>

				<div class="rk-actions">
					<Button variant="primary" size="lg" block disabled={!canFinish} onclick={finish}>
						{#if submitting}
							{m.settings_ceremony_recovery_saving()}
						{:else}
							{m.recovery_start_open_mailbox()}<ArrowRight size={17} />
						{/if}
					</Button>
					{#if submitError}
						<span class="rk-err rk-center"><CircleAlert size={13} /><span>{submitError}</span></span>
					{:else if !revealed && material}
						<p class="rk-hint">{m.recovery_start_hint_reveal()}</p>
					{:else if revealed && !anySaved}
						<p class="rk-hint">{m.recovery_start_hint_save()}</p>
					{:else if revealed && !ack}
						<p class="rk-hint">{m.recovery_start_hint_ack()}</p>
					{/if}
				</div>
			</section>
		</div>
	</div>

	<div class="rk-foot rk-screen">
		<p>{m.recovery_start_footer()}</p>
	</div>

	{#if material && revealed}
		<div class="rk-print" aria-hidden="true">
			<p class="rk-print-eyebrow">{m.recovery_kit_eyebrow()}</p>
			<h1>{m.recovery_kit_title()}</h1>
			<h2>{m.recovery_kit_phrase_heading()}</h2>
			<ol class="rk-print-words">
				{#each material.phrase as w, i (i)}
					<li><span class="rk-print-n">{i + 1}</span><span class="rk-print-w">{w}</span></li>
				{/each}
			</ol>
			{#each printSections as s (s.heading)}
				<h2>{s.heading}</h2>
				<p>{s.body}</p>
			{/each}
		</div>
	{/if}
</AuthShell>

<style>
	.rk-card {
		width: 760px;
		max-width: 100%;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-xs);
		padding: 32px 34px 28px;
		position: relative;
		overflow: hidden;
		animation: rk-cardin 0.32s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes rk-cardin {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rk-card {
			animation: none;
		}
	}

	.rk-head {
		margin: 0 0 24px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--border);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		flex-wrap: wrap;
	}
	.rk-head-tx {
		min-width: 0;
	}
	.rk-eyebrow {
		font-family: var(--font-mono);
		font-weight: 500;
		font-size: 10px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--accent-quiet);
		margin: 0 0 10px;
	}
	.rk-head h1 {
		font-family: var(--font-sans);
		font-feature-settings: normal;
		font-weight: 560;
		font-size: 25px;
		line-height: 1.16;
		letter-spacing: -0.02em;
		color: var(--fg-strong);
		margin: 0;
	}
	.rk-lede {
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--fg-muted);
		margin: 9px 0 0;
		max-width: 52ch;
		text-wrap: pretty;
	}
	.rk-acct {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px 9px 10px;
		background: var(--paper-50);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-control);
		flex: 0 0 auto;
		max-width: 100%;
	}
	.rk-acct .mono {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--fg-strong);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rk-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
		gap: 28px 32px;
		align-items: start;
	}
	.rk-col {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}
	.rk-label-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.rk-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--fg);
		white-space: nowrap;
	}
	.rk-meta {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--fg-faint);
		text-align: right;
		min-width: 0;
	}

	.rk-words {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.rk-word {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 9px;
		background: var(--paper-50);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-control);
		min-width: 0;
	}
	.rk-n {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--fg-faint);
		width: 14px;
		flex: 0 0 auto;
		text-align: right;
	}
	.rk-w {
		font-family: var(--font-mono);
		font-size: 13.5px;
		font-weight: 500;
		color: var(--pine-800);
		white-space: nowrap;
	}
	:global([data-theme='dark']) .rk-w {
		color: var(--pine-700);
	}
	.rk-cover {
		position: absolute;
		inset: 0;
		border: none;
		background: color-mix(in srgb, var(--surface) 72%, transparent);
		backdrop-filter: blur(3px);
		border-radius: var(--radius-control);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 14px;
		font-weight: 600;
		color: var(--pine-700);
		cursor: pointer;
		padding: 0 16px;
		text-align: center;
	}
	.rk-cover:hover:not(:disabled) {
		background: color-mix(in srgb, var(--surface) 82%, transparent);
	}
	.rk-cover:active:not(:disabled) {
		transform: translateY(1px);
	}
	.rk-cover:disabled {
		cursor: default;
	}
	.rk-cover-sub {
		font-size: 11.5px;
		font-weight: 400;
		color: var(--fg-muted);
	}
	.rk-note {
		font-size: 12px;
		line-height: 1.5;
		color: var(--fg-muted);
		margin: 0;
		text-wrap: pretty;
	}

	.rk-saved {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-weight: 600;
		color: var(--success-700);
	}
	.rk-ways {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.rk-way {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		text-align: left;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-control);
		background: var(--surface);
		padding: 11px 13px;
		box-shadow: var(--shadow-xs);
		cursor: pointer;
		font-family: inherit;
		color: inherit;
		transition:
			border-color 0.12s,
			background 0.12s;
	}
	.rk-way:hover:not(:disabled) {
		border-color: var(--pine-500);
		background: var(--paper-50);
	}
	.rk-way:active:not(:disabled) {
		transform: translateY(1px);
	}
	.rk-way:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.rk-way-ic {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--pine-50);
		color: var(--pine-700);
		flex: 0 0 auto;
	}
	.rk-way-tx {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}
	.rk-way-tx b {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--fg-strong);
	}
	.rk-way-tx span {
		font-size: 12px;
		color: var(--fg-muted);
		line-height: 1.4;
	}
	.rk-way-done {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--success-100);
		color: var(--success-700);
		flex: 0 0 auto;
	}
	.rk-way-go {
		display: flex;
		color: var(--ink-400);
		flex: 0 0 auto;
	}

	.rk-ack {
		display: flex;
		gap: 11px;
		align-items: flex-start;
		padding: 13px 14px;
		background: var(--paper-50);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-control);
	}
	.rk-ack :global([data-slot='checkbox']) {
		margin-top: 2px;
	}
	.rk-ack label {
		font-size: 13px;
		line-height: 1.5;
		color: var(--fg);
		cursor: pointer;
		text-wrap: pretty;
	}

	.rk-actions {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 2px;
	}
	.rk-hint {
		margin: 0;
		font-size: 12px;
		color: var(--fg-muted);
		line-height: 1.45;
		text-align: center;
	}
	.rk-err {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--danger-700);
	}
	.rk-center {
		justify-content: center;
	}

	.rk-foot {
		width: 760px;
		max-width: 100%;
	}
	.rk-foot p {
		text-align: left;
		font-size: 11.5px;
		color: var(--fg-faint);
		line-height: 1.6;
		margin: 18px 0 0;
		max-width: 64ch;
		text-wrap: pretty;
	}

	@media (max-width: 520px) {
		.rk-card {
			padding: 24px 20px 22px;
		}
		.rk-words {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.rk-print {
		display: none;
	}
	@media print {
		:global(.auth .langbar),
		:global(.auth .pagebrand),
		:global(.auth .stnotice),
		.rk-screen {
			display: none !important;
		}
		:global(.auth),
		:global(.auth .stagebody) {
			background: #fff !important;
			min-height: 0;
			padding: 0;
			display: block;
		}
		.rk-print {
			display: block;
			color: #000;
			font-family: var(--font-sans);
			font-size: 11pt;
			line-height: 1.5;
		}
		.rk-print-eyebrow {
			font-family: var(--font-mono);
			font-size: 8pt;
			letter-spacing: 0.09em;
			text-transform: uppercase;
			margin: 0 0 6pt;
		}
		.rk-print h1 {
			font-size: 20pt;
			font-weight: 600;
			margin: 0 0 18pt;
		}
		.rk-print h2 {
			font-size: 11pt;
			font-weight: 600;
			margin: 16pt 0 4pt;
		}
		.rk-print p {
			margin: 0;
		}
		.rk-print-words {
			list-style: none;
			padding: 0;
			margin: 8pt 0 0;
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 6pt;
		}
		.rk-print-words li {
			display: flex;
			gap: 8pt;
			align-items: baseline;
			border: 0.75pt solid #999;
			border-radius: 4pt;
			padding: 7pt 9pt;
		}
		.rk-print-n {
			font-family: var(--font-mono);
			font-size: 8pt;
			color: #555;
			min-width: 12pt;
			text-align: right;
		}
		.rk-print-w {
			font-family: var(--font-mono);
			font-size: 13pt;
			font-weight: 600;
		}
	}
</style>
