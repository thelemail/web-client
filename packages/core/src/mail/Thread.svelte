<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import { SvelteSet } from 'svelte/reactivity';
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import ThreadMessage from './ThreadMessage.svelte';
	import type { Message } from './data';

	interface Props {
		m: Message;
		onConfirmKeyChange?: (address: string) => void | Promise<void>;
	}

	let { m, onConfirmKeyChange }: Props = $props();

	const entries = $derived(m.thread ?? []);
	const lastIdx = $derived(entries.length - 1);

	const open = new SvelteSet<number>();

	$effect(() => {
		void m.id;
		const n = entries.length;
		open.clear();
		if (n > 0) open.add(n - 1);
	});

	const allOpen = $derived(open.size === entries.length);

	function toggle(i: number) {
		if (open.has(i)) open.delete(i);
		else open.add(i);
	}

	function expandAll() {
		open.clear();
		for (let i = 0; i < entries.length; i++) open.add(i);
	}

	function collapseAll() {
		open.clear();
		open.add(lastIdx);
	}
</script>

<div class="thread-wrap">
	<div class="thread-top">
		<span class="thr-n">
			<MessagesSquare size={14} />{msg.mail_thread_count({ count: entries.length })}
		</span>
		<button type="button" class="thr-exp" onclick={allOpen ? collapseAll : expandAll}>
			{allOpen ? msg.mail_thread_collapse_all() : msg.mail_thread_expand_all()}
		</button>
	</div>
	<div class="thread">
		{#each entries as e, i (e.id ?? `${m.id}-${e.epoch}`)}
			<ThreadMessage
				{e}
				isOpen={open.has(i)}
				onToggle={() => toggle(i)}
				{onConfirmKeyChange}
			/>
		{/each}
	</div>
</div>
