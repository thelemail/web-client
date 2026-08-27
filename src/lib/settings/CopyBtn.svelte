<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';

	interface Props {
		text: string;
		small?: boolean;
		label?: string;
	}

	let { text, small = false, label = 'Copy' }: Props = $props();

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
	title="Copy to clipboard"
	aria-label="Copy"
>
	{#if done}<Check size={small ? 13 : 14} />{:else}<Copy size={small ? 13 : 14} />{/if}
	{#if !small}<span>{done ? 'Copied' : label}</span>{/if}
</button>
