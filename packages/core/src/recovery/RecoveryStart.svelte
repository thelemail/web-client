<script lang="ts">
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { platform } from '$platform';
	import Eye from '@lucide/svelte/icons/eye';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import Printer from '@lucide/svelte/icons/printer';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { auth } from '$core/stores/session.svelte';
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
			if (isReauthenticationRequired(err)) {
				generateError = m.recovery_start_confirm_needed();
				return;
			}
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
			submitting = false;
			if (isReauthenticationRequired(err)) return;
			console.warn('recovery: setup failed', err);
			submitError = m.settings_ceremony_recovery_err_save();
			return;
		}
		auth.markRecoveryEnabled(accountId);
		void auth.loadProfile(accountId);
		await goto(returnTo);
	}
</script>

<AuthShell strip={false}>
	<div class="card rk-screen">
		<div class="sp">
			<p class="sent sm">{m.auth_s_recovery_sentence()}</p>
			<div class="sp-under wide">
				<p class="sp-msg rk-meta"><span class="mono">{email}</span><span aria-hidden="true">·</span><span>{m.recovery_start_phrase_meta()}</span></p>
				<div class="sp-words" aria-label={m.recovery_start_phrase_label()}>
					{#each words as w, i (i)}
						<div class="sp-word"><span class="n">{i + 1}</span><b class:rk-hidden={!revealed}>{revealed && w ? w : '••••••'}</b></div>
					{/each}
					{#if !revealed}
						<div class="rk-cover">
							{#if material}
								<Button variant="secondary" size="lg" onclick={() => (revealed = true)}>
									<Eye size={17} />{m.settings_ceremony_recovery_reveal()}
								</Button>
							{:else if generateError}
								<span class="sp-msg bad" role="alert"><CircleAlert size={14} /><span>{generateError}</span></span>
							{:else}
								<span class="sp-msg"><span class="spinner"></span><span>{m.settings_ceremony_recovery_generating()}</span></span>
							{/if}
						</div>
					{/if}
				</div>
				{#if generateError}
					<div class="sp-acts">
						<Button variant="secondary" size="lg" disabled={generating} onclick={generate}>
							<RotateCw size={15} />{m.recovery_start_retry()}
						</Button>
					</div>
				{/if}
				<p class="sp-fine">{m.recovery_start_phrase_note()}</p>
			</div>
			<div class="sp-under wide">
				<p class="sp-msg rk-keep">{m.auth_s_recovery_keep()}</p>
				<div class="rk-ways">
					{#each ways as way (way.key)}
						<button type="button" class="rk-way" class:saved={saved[way.key]} disabled={!revealed} onclick={way.run}>
							<b>
								{#if saved[way.key]}<Check size={15} strokeWidth={2.2} />{:else}<way.icon size={15} />{/if}{way.title}
							</b>
							<span>{way.sub}</span>
						</button>
					{/each}
				</div>
				{#if saveError}
					<p class="sp-msg bad" role="alert"><CircleAlert size={14} /><span>{saveError}</span></p>
				{/if}
				<label class="sp-tick">
					<input type="checkbox" bind:checked={ack} />
					<span>{m.recovery_start_ack()}</span>
				</label>
				<div class="sp-acts">
					<Button variant="primary" size="lg" disabled={!canFinish} onclick={finish}>
						{#if submitting}<span class="spinner"></span>{m.settings_ceremony_recovery_saving()}{:else}{m.recovery_start_open_mailbox()}{/if}
					</Button>
					{#if !submitError}
						{#if !revealed && material}
							<span class="sp-fine">{m.recovery_start_hint_reveal()}</span>
						{:else if revealed && !anySaved}
							<span class="sp-fine">{m.recovery_start_hint_save()}</span>
						{:else if revealed && !ack}
							<span class="sp-fine">{m.recovery_start_hint_ack()}</span>
						{/if}
					{/if}
				</div>
				{#if submitError}
					<p class="sp-err" role="alert"><CircleAlert size={15} /><span>{submitError}</span></p>
				{/if}
				<p class="sp-fine">{m.recovery_start_footer()}</p>
			</div>
		</div>
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
	.rk-meta {
		gap: 8px;
		flex-wrap: wrap;
	}
	.rk-hidden {
		filter: blur(6px);
		user-select: none;
	}
	.rk-cover {
		position: absolute;
		inset: -4px;
		display: grid;
		place-items: center;
		border-radius: 12px;
		background: color-mix(in srgb, var(--bg) 62%, transparent);
	}
	.rk-keep {
		font-family: var(--font-mono);
		font-size: 11.5px;
		letter-spacing: var(--track-caps);
		text-transform: uppercase;
		color: var(--fg-faint);
	}
	.rk-ways {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 8px;
	}
	.rk-way {
		all: unset;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px 14px;
		border-radius: 10px;
		border: 1px solid var(--border-control);
		background: var(--surface);
		cursor: pointer;
		transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
	}
	.rk-way:hover:not(:disabled) {
		border-color: var(--border-strong);
	}
	.rk-way:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
	}
	.rk-way:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.rk-way.saved {
		border-color: var(--pine-500);
		background: var(--accent);
	}
	.rk-way b {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 14px;
		color: var(--fg-strong);
	}
	.rk-way span {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--fg-muted);
	}

	.rk-print {
		display: none;
	}
	@media print {
		:global(.auth .topbar),
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
