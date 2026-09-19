<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { m } from '$paraglide/messages.js';

	interface Props {
		text: string;
		small?: boolean;
		label?: string;
	}

	let { text, small = false, label }: Props = $props();

	let done = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			if (navigator?.clipboard) await navigator.clipboard.writeText(text);
		} catch {
		}
		done = true;
		clearTimeout(timer);
		timer = setTimeout(() => (done = false), 1300);
	}
</script>

<button
	type="button"
	class="copy-btn"
	class:sm={small}
	class:done
	onclick={copy}
	title={m.settings_copy_to_clipboard()}
	aria-label={m.common_copy()}
>
	{#if done}<Check size={small ? 13 : 14} />{:else}<Copy size={small ? 13 : 14} />{/if}
	{#if !small}<span>{done ? m.common_copied() : (label ?? m.common_copy())}</span>{/if}
</button>
