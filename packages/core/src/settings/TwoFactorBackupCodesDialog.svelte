<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { platform } from '$platform';
	import Icon from '$core/components/Icon.svelte';
	import {
		faCheck,
		faCircleExclamation,
		faCopy,
		faDownload,
		faShieldCheck
	} from '@fortawesome/pro-regular-svg-icons';
	import CeremonyShell from './CeremonyShell.svelte';
	import SecretLeaveConfirm from './SecretLeaveConfirm.svelte';
	import { auth } from '$core/stores/session.svelte';
	import { Button } from '$core/components/ui/button';
	import { backupCodesFile } from '$core/auth/backup-codes';

	interface Props {
		codes: string[];
		onClose: () => void;
	}

	let { codes, onClose }: Props = $props();

	let saved = $state(false);
	let copyFailed = $state(false);
	let leaving = $state(false);

	function requestClose() {
		if (saved) onClose();
		else leaving = true;
	}

	async function copyCodes() {
		try {
			await navigator.clipboard.writeText(codes.join('\n'));
			saved = true;
			copyFailed = false;
		} catch (err) {
			console.warn('twofa: clipboard write failed', err);
			copyFailed = true;
		}
	}

	async function downloadCodes() {
		await platform.saveBlob(backupCodesFile(codes, auth.email ?? ''), 'thelemail-backup-codes.txt');
		saved = true;
		copyFailed = false;
	}
</script>

<CeremonyShell
	icon={faShieldCheck}
	eyebrow={m.settings_security_eyebrow()}
	title={m.settings_security_backup_new_title()}
	onClose={requestClose}
>
	<div class="cer-pane">
		<div class="cer-instruct">
			{m.settings_security_backup_new_lede()}
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
				<Icon icon={faCopy} size={14} />{m.common_copy()}
			</Button>
			<Button variant="secondary" size="sm" onclick={downloadCodes}>
				<Icon icon={faDownload} size={14} />{m.settings_security_backup_download()}
			</Button>
			{#if saved}<span class="phrase-saved"><Icon icon={faCheck} size={13} />{m.settings_security_backup_saved()}</span>{/if}
		</div>
		{#if copyFailed}
			<div class="field-hint bad" role="alert"><Icon icon={faCircleExclamation} size={13} />{m.settings_secret_copy_failed()}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="primary" disabled={!saved} onclick={onClose}>
			{m.settings_security_backup_saved_them()}<Icon icon={faCheck} size={15} />
		</Button>
	{/snippet}
</CeremonyShell>

{#if leaving}
	<SecretLeaveConfirm desc={m.settings_secret_leave_backup_codes()} onStay={() => (leaving = false)} onLeave={onClose} />
{/if}
