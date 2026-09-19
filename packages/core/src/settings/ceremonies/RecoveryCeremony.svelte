<script lang="ts">
	import { platform } from '$platform';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Eye from '@lucide/svelte/icons/eye';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CeremonyShell from '../CeremonyShell.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import {
		getModulus,
		recoveryOpaqueRegistrationInit,
		recoverySetup,
		recoverySetupOpaque
	} from '$core/api/auth';
	import { keystore } from '$core/keystore/keystore-client';
	import { auth } from '$core/stores/auth.svelte';
	import type { CeremonyKind } from '../data';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	interface SrpSetupMaterial {
		scheme: 'srp_v1';
		phrase: string[];
		srpSalt: string;
		srpVerifier: string;
		keySalt: string;
		encryptedPrivateKey: string;
	}

	interface OpaqueSetupMaterial {
		scheme: 'opaque_v1';
		phrase: string[];
		opaqueRecord: string;
		wrappedMasterKey: string;
		masterKeyId: string;
		opaqueParamsVersion: number;
	}

	type SetupMaterial = SrpSetupMaterial | OpaqueSetupMaterial;

	let step = $state(0);
	let ack = $state(false);
	let revealed = $state(false);
	let saved = $state(false);
	let setup = $state<SetupMaterial | null>(null);
	let generating = $state(false);
	let generateError = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let quizIdx = $state<number[]>([]);
	let answers = $state(['', '', '']);

	const regenerating = $derived(auth.recoveryEnabled === true);

	const quiz = $derived(
		setup ? quizIdx.map((i) => ({ i, word: setup!.phrase[i] })) : []
	);
	const allCorrect = $derived(
		quiz.length > 0 && quiz.every((q, j) => answers[j].trim().toLowerCase() === q.word)
	);

	const steps = $derived([
		m.settings_ceremony_recovery_step_why(),
		m.settings_ceremony_recovery_step_phrase(),
		m.settings_ceremony_recovery_step_confirm(),
		m.settings_ceremony_recovery_step_done()
	]);

	function pickQuizIndices(): number[] {
		const pool = Array.from({ length: 12 }, (_, i) => i);
		const rnd = new Uint32Array(11);
		crypto.getRandomValues(rnd);
		for (let i = pool.length - 1; i > 0; i--) {
			const j = rnd[pool.length - 1 - i] % (i + 1);
			[pool[i], pool[j]] = [pool[j], pool[i]];
		}
		return pool.slice(0, 3).sort((a, b) => a - b);
	}

	async function generateSrp(accountId: string): Promise<boolean> {
		const { modulus } = await getModulus();
		const res = await keystore.prepareRecoverySetup({ accountId, modulus });
		if (!res.ok) {
			generateError = m.settings_ceremony_recovery_err_locked();
			return false;
		}
		setup = {
			scheme: 'srp_v1',
			phrase: res.phrase.split(' '),
			srpSalt: res.srpSalt,
			srpVerifier: res.srpVerifier,
			keySalt: res.keySalt,
			encryptedPrivateKey: res.encryptedPrivateKey
		};
		return true;
	}

	async function generateOpaque(accountId: string): Promise<boolean> {
		const start = await keystore.opaqueRecoverySetupStart({ accountId });
		if (!start.ok) {
			generateError = m.settings_ceremony_recovery_err_locked();
			return false;
		}
		const init = await recoveryOpaqueRegistrationInit(
			{ registrationRequest: start.registrationRequest },
			accountId
		);
		const finish = await keystore.opaqueRecoverySetupFinish({
			accountId,
			operationId: start.operationId,
			registrationResponse: init.registrationResponse
		});
		if (!finish.ok) {
			generateError = m.settings_ceremony_recovery_err_generate();
			return false;
		}
		setup = {
			scheme: 'opaque_v1',
			phrase: start.phrase.split(' '),
			opaqueRecord: finish.opaqueRecord,
			wrappedMasterKey: finish.wrappedMasterKey,
			masterKeyId: finish.masterKeyId,
			opaqueParamsVersion: finish.opaqueParamsVersion
		};
		return true;
	}

	async function generate() {
		if (generating) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		generating = true;
		generateError = '';
		try {
			const status = await keystore.status();
			const scheme = status.accounts.find((a) => a.accountId === accountId)?.authScheme ?? 'srp_v1';
			const ok = scheme === 'opaque_v1' ? await generateOpaque(accountId) : await generateSrp(accountId);
			if (!ok) return;
			quizIdx = pickQuizIndices();
			answers = ['', '', ''];
			revealed = false;
			saved = false;
			step = 1;
		} catch (err) {
			console.warn('recovery: generate failed', err);
			generateError = m.settings_ceremony_recovery_err_generate();
		} finally {
			generating = false;
		}
	}

	async function copyPhrase() {
		if (!setup) return;
		try {
			await navigator.clipboard.writeText(setup.phrase.join(' '));
			saved = true;
		} catch (err) {
			console.warn('recovery: clipboard write failed', err);
		}
	}

	async function downloadKit() {
		if (!setup) return;
		const lines = [
			'Thelemail recovery kit',
			'======================',
			'',
			`Account:   ${auth.email ?? ''}`,
			`Generated: ${new Date().toISOString().slice(0, 10)}`,
			'',
			'Your twelve-word recovery phrase, in order:',
			'',
			...setup.phrase.map((w, i) => `  ${String(i + 1).padStart(2, ' ')}. ${w}`),
			'',
			'Anyone with these words can unlock your mail and reset your password.',
			'Keep this file offline — print it or store it on an encrypted drive,',
			'then delete it from your downloads.',
			''
		];
		const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
		await platform.saveBlob(blob, 'thelemail-recovery-kit.txt');
		saved = true;
	}

	async function confirmAndStore() {
		if (!setup || submitting) return;
		submitting = true;
		submitError = '';
		try {
			if (setup.scheme === 'opaque_v1') {
				await recoverySetupOpaque({
					opaqueRecord: setup.opaqueRecord,
					wrappedMasterKey: setup.wrappedMasterKey,
					masterKeyId: setup.masterKeyId,
					opaqueParamsVersion: setup.opaqueParamsVersion
				});
			} else {
				await recoverySetup({
					srpSalt: setup.srpSalt,
					srpVerifier: setup.srpVerifier,
					keySalt: setup.keySalt,
					encryptedPrivateKey: setup.encryptedPrivateKey,
					kdfParamsVersion: 1,
					srpParamsVersion: 1
				});
			}
			void auth.loadProfile();
			step = 3;
		} catch (err) {
			console.warn('recovery: setup failed', err);
			submitError = m.settings_ceremony_recovery_err_save();
		} finally {
			submitting = false;
		}
	}

	function finish() {
		setup = null;
		onComplete('recovery');
		onClose();
	}
</script>

<CeremonyShell
	icon={LifeBuoy}
	eyebrow={m.settings_ceremony_recovery_eyebrow()}
	title={m.settings_ceremony_recovery_title()}
	{steps}
	{step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					<Rich text={m.settings_ceremony_recovery_lede_zero_access()} tags={{ b: bold }} />
				</p>
				<p>{m.settings_ceremony_recovery_lede_spare_key()}</p>
				{#if regenerating}
					<p>
						<Rich text={m.settings_ceremony_recovery_lede_regenerate()} tags={{ b: bold }} />
					</p>
				{/if}
			</div>
			<ul class="cer-points">
				<li><ShieldCheck size={16} /><span>{m.settings_ceremony_recovery_point_offline()}</span></li>
				<li>
					<TriangleAlert size={16} /><span>{m.settings_ceremony_recovery_point_gone()}</span>
				</li>
				<li>
					<Lock size={16} /><span>{m.settings_ceremony_recovery_point_deed()}</span>
				</li>
			</ul>
			<label class="cer-ack">
				<input type="checkbox" bind:checked={ack} />
				<span>{m.settings_ceremony_recovery_ack()}</span>
			</label>
			{#if generateError}
				<span class="errtext"><CircleAlert size={13} /><span>{generateError}</span></span>
			{/if}
		</div>
	{:else if step === 1 && setup}
		<div class="cer-pane">
			<div class="cer-instruct">
				<Rich text={m.settings_ceremony_recovery_instruct_write()} tags={{ b: bold }} />
			</div>
			<div class="phrase-grid" class:shown={revealed}>
				{#each setup.phrase as w, i (i)}
					<div class="pw">
						<span class="pw-n">{i + 1}</span>
						<span class="pw-w">{w}</span>
					</div>
				{/each}
				{#if !revealed}
					<button type="button" class="phrase-cover" onclick={() => (revealed = true)}>
						<Eye size={18} />{m.settings_ceremony_recovery_reveal()}
						<span class="pc-sub">{m.settings_ceremony_recovery_reveal_sub()}</span>
					</button>
				{/if}
			</div>
			<div class="phrase-acts">
				<Button variant="secondary" size="sm" disabled={!revealed} onclick={copyPhrase}>
					<Copy size={14} />{m.common_copy()}
				</Button>
				<Button variant="secondary" size="sm" disabled={!revealed} onclick={downloadKit}>
					<Download size={14} />{m.settings_ceremony_recovery_download()}
				</Button>
				{#if saved}<span class="phrase-saved"><Check size={13} />{m.settings_ceremony_recovery_saved()}</span>{/if}
			</div>
		</div>
	{:else if step === 2}
		<div class="cer-pane">
			<div class="cer-instruct">{m.settings_ceremony_recovery_instruct_confirm()}</div>
			<div class="quiz">
				{#each quiz as q, j (q.i)}
					{@const val = answers[j]}
					{@const ok = val.trim().toLowerCase() === q.word}
					{@const bad = val.length > 0 && !ok}
					<div class="quiz-row" class:ok class:bad>
						<span class="quiz-n">{m.settings_ceremony_recovery_word_n({ n: q.i + 1 })}</span>
						<input
							class="tin mono"
							value={val}
							placeholder="…"
							autocomplete="off"
							autocapitalize="none"
							spellcheck={false}
							oninput={(e) =>
								(answers = answers.map((x, k) =>
									k === j ? (e.currentTarget as HTMLInputElement).value : x
								))}
						/>
						{#if ok}<Check size={16} />{:else if bad}<X size={16} />{/if}
					</div>
				{/each}
			</div>
			<button type="button" class="quiz-back" onclick={() => (step = 1)}>
				<Eye size={14} />{m.settings_ceremony_recovery_show_again()}
			</button>
			{#if submitError}
				<span class="errtext"><CircleAlert size={13} /><span>{submitError}</span></span>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={ShieldCheck}
			title={m.settings_ceremony_recovery_done_title()}
			desc={m.settings_ceremony_recovery_done_desc()}
		>
			<div class="cer-reminder">
				<Lock size={15} />{m.settings_ceremony_recovery_done_reminder()}
			</div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!ack || generating} onclick={generate}>
				{#if generating}
					{m.settings_ceremony_recovery_generating()}
				{:else}
					{m.settings_ceremony_recovery_generate()}<ArrowRight size={15} />
				{/if}
			</Button>
		{:else if step === 1}
			<Button variant="ghost" onclick={() => (step = 0)}>
				<ArrowLeft size={15} />{m.common_back()}
			</Button>
			<Button variant="primary" disabled={!revealed} onclick={() => (step = 2)}>
				{m.settings_ceremony_recovery_written_down()}<ArrowRight size={15} />
			</Button>
		{:else if step === 2}
			<Button variant="ghost" onclick={() => (step = 1)}>
				<ArrowLeft size={15} />{m.common_back()}
			</Button>
			<Button variant="primary" disabled={!allCorrect || submitting} onclick={confirmAndStore}>
				{#if submitting}
					{m.settings_ceremony_recovery_saving()}
				{:else}
					{m.settings_ceremony_recovery_confirm_finish()}<Check size={15} />
				{/if}
			</Button>
		{:else}
			<Button variant="primary" onclick={finish}>{m.common_done()}</Button>
		{/if}
	{/snippet}
</CeremonyShell>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
