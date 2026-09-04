<script lang="ts">
	import Code from '@lucide/svelte/icons/code';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { auth } from '$lib/stores/auth.svelte';
	import { DecryptionError } from './decrypt';
	import { loadOriginalHeaders } from './originalHeaders';
	import { Button } from '$lib/components/ui/button';

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
				? 'Unlock this account to read the original headers.'
				: 'The message body could not be decrypted.';
		}
		return err instanceof Error && err.message
			? err.message
			: 'The original headers could not be loaded.';
	}

	$effect(() => {
		const id = messageId;
		let cancelled = false;
		view = { status: 'loading' };
		void (async () => {
			const accountId = auth.accountId;
			if (!accountId) {
				if (!cancelled) {
					view = { status: 'error', message: 'Unlock this account to read the original headers.' };
				}
				return;
			}
			try {
				const headers = await loadOriginalHeaders(accountId, id);
				if (cancelled) return;
				view = headers
					? { status: 'ready', headers }
					: { status: 'error', message: 'This message was stored without a header block.' };
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

	function handleKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.stopPropagation();
		onClose();
	}

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<svelte:document onkeydowncapture={handleKey} />

<div
	class="oh-scrim"
	role="dialog"
	aria-modal="true"
	aria-labelledby="oh-title"
	tabindex="-1"
	onmousedown={scrimMouseDown}
>
	<div class="oh-modal" role="presentation" onmousedown={(e) => e.stopPropagation()}>
		<div class="oh-head">
			<span class="oh-ic"><Code size={17} /></span>
			<div class="oh-tx">
				<h2 class="oh-title" id="oh-title">Original headers</h2>
				{#if subject}
					<div class="oh-sub" title={subject}>{subject}</div>
				{/if}
			</div>
			<button type="button" class="oh-x" title="Close" onclick={onClose}>
				<X size={16} />
			</button>
		</div>

		{#if view.status === 'loading'}
			<div class="oh-note">Fetching and decrypting the stored message…</div>
		{:else if view.status === 'error'}
			<div class="oh-note err" role="alert">{view.message}</div>
		{:else}
			<pre class="oh-pre">{view.headers}</pre>
		{/if}

		<div class="oh-actions">
			<Button variant="secondary" onclick={onClose}>Close</Button>
			<Button variant="primary" disabled={view.status !== 'ready'} onclick={copy}>
				{#if copied}
					<Check size={15} />Copied
				{:else}
					<Copy size={15} />Copy
				{/if}
			</Button>
		</div>
	</div>
</div>
