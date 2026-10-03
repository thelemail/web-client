<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import MailMinus from '@lucide/svelte/icons/mail-minus';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import Rich from '$core/i18n/Rich.svelte';
	import { platform } from '$platform';
	import { unsubscribeMessage } from '$core/api/messages';
	import { ApiCallError } from '$core/api/types';
	import { auth } from '$core/stores/auth.svelte';
	import { addresses } from '$core/stores/addresses.svelte';
	import { dispatchSend } from './sendDispatch';
	import { chooseFrom, sendIdentityOf } from './identities';
	import type { UnsubscribeMethod } from './unsubscribe';

	interface Props {
		messageId: string;
		senderName: string;
		senderAddress: string;
		deliveredTo?: string;
		method: UnsubscribeMethod;
		onClose: () => void;
		onUnsubscribed: (name: string, kind: UnsubscribeMethod['kind']) => void;
	}

	let { messageId, senderName, senderAddress, deliveredTo, method, onClose, onUnsubscribed }: Props =
		$props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	const name = $derived(senderName.trim() || senderAddress);
	const sub = $derived(senderName && senderName !== senderAddress ? `${senderName} · ${senderAddress}` : senderAddress);

	const identity = $derived.by<{ email: string; name: string; aliasId?: string } | null>(() => {
		const own = deliveredTo ? addresses.getByRecipient(deliveredTo) : null;
		const options = addresses.sendable.map((a) => sendIdentityOf(a, auth.fullName));
		const chosen = chooseFrom(options, own?.email ?? null).identity;
		if (chosen) return chosen;
		return auth.email ? { email: auth.email, name: auth.fullName ?? auth.email } : null;
	});

	function hostOf(url: string): string {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	}

	function failureText(e: unknown): string {
		if (e instanceof ApiCallError) {
			switch (e.envelope?.error.code) {
				case 'unsubscribe_rejected':
					return m.mail_unsub_rejected({ name });
				case 'unsubscribe_unreachable':
					return m.mail_unsub_unreachable({ name });
				case 'rate_limited':
					return m.mail_unsub_rate_limited();
			}
		}
		return m.mail_unsub_failed();
	}

	async function confirm() {
		if (method.kind === 'page') {
			platform.openLink(method.url);
			onClose();
			return;
		}
		if (!auth.accountId) {
			error = m.mail_unsub_unlock_required();
			return;
		}
		busy = true;
		error = null;
		try {
			if (method.kind === 'one-click') {
				await unsubscribeMessage(messageId, { url: method.url, tag: method.tag });
			} else {
				const from = identity;
				await dispatchSend({
					to: [{ address: method.to }],
					subject: method.subject,
					body: method.body,
					fromEmail: from?.email,
					fromName: from?.name,
					fromAliasId: from?.aliasId
				});
			}
			onUnsubscribed(name, method.kind);
			busy = false;
			onClose();
		} catch (e) {
			error = failureText(e);
			busy = false;
		}
	}
</script>

<ConfirmDialog
	icon={MailMinus}
	title={m.mail_unsub_title({ name })}
	{sub}
	confirmLabel={method.kind === 'page' ? m.mail_unsub_open_page() : m.mail_unsub_confirm()}
	{busy}
	{error}
	disabled={method.kind === 'mailto' && !identity}
	onConfirm={() => void confirm()}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">
			{#if method.kind === 'one-click'}
				<Rich text={m.mail_unsub_body_one_click({ domain: hostOf(method.url) })} tags={{ mono }} />
			{:else if method.kind === 'mailto'}
				<Rich
					text={m.mail_unsub_body_mailto({ from: identity?.email ?? '', to: method.to })}
					tags={{ mono }}
				/>
			{:else}
				<Rich text={m.mail_unsub_body_page({ host: hostOf(method.url) })} tags={{ mono }} />
			{/if}
		</p>
	{/snippet}
</ConfirmDialog>

{#snippet mono(t: string)}<span class="cfd-mono">{t}</span>{/snippet}
