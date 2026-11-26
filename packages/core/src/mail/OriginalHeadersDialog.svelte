<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { faCheck, faCode, faCopy } from '@fortawesome/pro-regular-svg-icons';
	import { auth } from '$core/stores/auth.svelte';
	import { DecryptionError } from './decrypt';
	import { loadOriginalHeaders } from './originalHeaders';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';

	interface Props {
		messageId: string;
		subject?: string;
		onClose: () => void;
	}

	let { messageId, subject = '', onClose }: Props = $props();

	type State =
		| { status: 'loading' }
		| { status: 'ready'; headers: string }
		| { status: 'error'; message: string };

	let view = $state<State>({ status: 'loading' });
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	function failureText(err: unknown): string {
		if (err instanceof DecryptionError) {
			return err.code === 'locked'
				? m.mail_headers_locked()
				: m.mail_headers_decrypt_failed();
		}
		return err instanceof Error && err.message
			? err.message
			: m.mail_headers_load_failed();
	}

	$effect(() => {
		const id = messageId;
		let cancelled = false;
		view = { status: 'loading' };
		void (async () => {
			const accountId = auth.accountId;
			if (!accountId) {
				if (!cancelled) {
					view = { status: 'error', message: m.mail_headers_locked() };
				}
				return;
			}
			try {
				const headers = await loadOriginalHeaders(accountId, id);
				if (cancelled) return;
				view = headers
					? { status: 'ready', headers }
					: { status: 'error', message: m.mail_headers_missing() };
			} catch (err) {
				if (cancelled) return;
				view = { status: 'error', message: failureText(err) };
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => () => clearTimeout(copyTimer));

	async function copy() {
		if (view.status !== 'ready') return;
		try {
			await navigator.clipboard.writeText(view.headers);
			copied = true;
			clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = false), 1800);
		} catch {
			copied = false;
		}
	}
</script>

<Dialog.Root
	bind:open={
		() => true,
		(open) => {
			if (!open) onClose();
		}
	}
>
	<Dialog.Content size="lg">
		<Dialog.Header icon={faCode}>
			<Dialog.Title>{m.mail_headers_title()}</Dialog.Title>
			{#if subject}
				<Dialog.Description class="dialog-sub" title={subject}>{subject}</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="dialog-body">
			{#if view.status === 'loading'}
				<div class="oh-note">{m.mail_headers_loading()}</div>
			{:else if view.status === 'error'}
				<div class="oh-note err" role="alert">{view.message}</div>
			{:else}
				<pre class="oh-pre">{view.headers}</pre>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="neutral" onclick={onClose}>{m.common_close()}</Button>
			<Button variant="primary" disabled={view.status !== 'ready'} onclick={copy}>
				{#if copied}
					<Icon icon={faCheck} size={15} />{m.common_copied()}
				{:else}
					<Icon icon={faCopy} size={15} />{m.common_copy()}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
