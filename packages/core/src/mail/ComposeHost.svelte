<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Compose from './Compose.svelte';
	import Toast from '$core/components/Toast.svelte';
	import { composeStore, type ComposeSession } from '$core/stores/compose.svelte';
	import { drafts } from '$core/stores/drafts.svelte';
	import { scheduled } from '$core/stores/scheduled.svelte';
	import { mailbox } from '$core/stores/mailbox.svelte';
	import { DEFAULT_QUERY } from './url';
	import { formatWhenLong } from './data';

	let toast = $state<{ text: string } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function flash(text: string) {
		toast = { text };
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 2600);
	}

	function returnFocus(s: ComposeSession | null) {
		const el = s?.returnFocus;
		if (el?.isConnected) el.focus();
	}

	function closed(key: string) {
		returnFocus(composeStore.close(key));
	}

	function sent(key: string, info?: { scheduledAt?: string }) {
		const s = composeStore.close(key);
		returnFocus(s);
		if (info?.scheduledAt) {
			flash(m.mail_toast_scheduled({ when: formatWhenLong(new Date(info.scheduledAt)) }));
			void scheduled.refresh();
		} else {
			flash(m.mail_toast_sent());
		}
		if (s?.forward) mailbox.noteReplySent(s.forward.source);
		void drafts.refresh();
		void mailbox.refresh([
			{ ...DEFAULT_QUERY, folder: 'inbox' },
			{ ...DEFAULT_QUERY, folder: 'sent' }
		]);
	}
</script>

{#if composeStore.open}
	<div class="compose-layer" class:stacked={composeStore.sessions.length > 1}>
		{#each composeStore.sessions as s (s.key)}
			<Compose
				draftId={s.draftId}
				view={composeStore.focused === s.key ? (composeStore.expanded ? 'expanded' : 'float') : 'min'}
				onFocus={() => composeStore.focus(s.key)}
				onMinimize={() => composeStore.minimize(s.key)}
				onExpand={(next) => composeStore.setExpanded(next)}
				onDraftId={(id) => composeStore.bindDraft(s.key, id)}
				onClose={() => closed(s.key)}
				onSend={(info) => sent(s.key, info)}
			/>
		{/each}
	</div>
{/if}

{#if toast}
	<Toast text={toast.text} shift={131} />
{/if}
