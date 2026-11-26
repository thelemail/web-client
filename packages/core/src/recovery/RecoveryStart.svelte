<script lang="ts">
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { platform } from '$platform';
	import Icon from '$core/components/Icon.svelte';
	import {
		faCheck,
		faCopy,
		faDownload,
		faEye,
		faPrint,
		faRotateRight
	} from '@fortawesome/pro-regular-svg-icons';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import Status from '$core/auth/form/Status.svelte';
	import BusyLabel from '$core/auth/form/BusyLabel.svelte';
	import { delayed } from '$core/async/delayed.svelte';
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
	const preparing = delayed(() => !material && !generateError);
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
				icon: faDownload,
				title: m.recovery_start_way_pdf(),
				sub: m.recovery_start_way_pdf_sub(),
				run: downloadPdf
			},
			{
				key: 'copy' as const,
				icon: faCopy,
				title: m.recovery_start_way_copy(),
				sub: m.recovery_start_way_copy_sub(),
				run: copyPhrase
			},
			...(canPrint
				? [
						{
							key: 'print' as const,
							icon: faPrint,
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
		<div class="card-surface">
			<div class="card-head">
				<h1>{m.recovery_start_title()}</h1>
				<p>{m.auth_s_recovery_sentence()}</p>
			</div>
			<div class="af-phrase">
				<p class="rk-meta"><span class="mono">{email}</span><span aria-hidden="true">·</span><span>{m.recovery_start_phrase_meta()}</span></p>
				<div class="af-words" aria-label={m.recovery_start_phrase_label()}>
					{#each words as w, i (i)}
						<div class="af-word" style:--i={i}><span class="n">{i + 1}</span><b class:rk-hidden={!revealed}>{revealed && w ? w : '••••••'}</b></div>
					{/each}
				</div>
				{#if !revealed}
					<div class="rk-cover">
						{#if material}
							<Button variant="secondary" size="lg" onclick={() => (revealed = true)}>
								<Icon icon={faEye} size={17} />{m.settings_ceremony_recovery_reveal()}
							</Button>
						{:else if generateError}
							<div class="rk-failed">
								<Status tone="bad">{generateError}</Status>
								<Button variant="secondary" size="lg" disabled={generating} onclick={generate}>
									<Icon icon={faRotateRight} size={15} />{m.recovery_start_retry()}
								</Button>
							</div>
						{:else if preparing.visible}
							<Status tone="busy">{m.settings_ceremony_recovery_generating()}</Status>
						{/if}
					</div>
				{/if}
			</div>
			<p class="af-fine">{m.recovery_start_phrase_note()}</p>
			<div class="field">
				<div class="lab"><span class="lbl">{m.auth_s_recovery_keep()}</span></div>
				<div class="af-options">
					{#each ways as way (way.key)}
						<button type="button" class="af-option" class:done={saved[way.key]} disabled={!revealed} onclick={way.run}>
							<span class="ic">{#if saved[way.key]}<Icon icon={faCheck} size={17} />{:else}<Icon icon={way.icon} size={17} />{/if}</span>
							<span class="tx"><b>{way.title}</b><span>{way.sub}</span></span>
						</button>
					{/each}
				</div>
			</div>
			<label class="af-tick">
				<input type="checkbox" bind:checked={ack} />
				<span>{m.recovery_start_ack()}</span>
			</label>
			<Status tone={submitError || saveError ? 'bad' : 'hint'} reserve>
				{#if submitError}{submitError}
				{:else if saveError}{saveError}
				{:else if !revealed && material}{m.recovery_start_hint_reveal()}
				{:else if revealed && !anySaved}{m.recovery_start_hint_save()}
				{:else if revealed && !ack}{m.recovery_start_hint_ack()}{/if}
			</Status>
			<Button variant="primary" size="lg" block disabled={!canFinish} onclick={finish}>
				<BusyLabel busy={submitting} label={m.recovery_start_open_mailbox()} pending={m.settings_ceremony_recovery_saving()} />
			</Button>
			<p class="af-fine center">{m.recovery_start_footer()}</p>
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
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 2px 2px 10px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--fg-muted);
	}
	.rk-hidden {
		filter: blur(6px);
		user-select: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.af-word b:not(.rk-hidden) {
			animation: rk-reveal 520ms var(--ease-out) calc(var(--i, 0) * 30ms) backwards;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.af-word b:not(.rk-hidden) {
			animation: rk-fade var(--dur) linear backwards;
		}
	}
	@keyframes rk-reveal {
		from {
			filter: blur(6px);
			opacity: 0.4;
		}
	}
	@keyframes rk-fade {
		from {
			opacity: 0;
		}
	}
	.rk-cover {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border-radius: 16px;
		background: color-mix(in srgb, var(--bg-raised) 55%, transparent);
	}
	.rk-failed {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		max-width: 420px;
		padding: 0 16px;
		text-align: center;
	}

	.rk-print {
		display: none;
	}
	@media print {
		:global(.auth .topbar),
		:global(.auth .pagefoot),
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
