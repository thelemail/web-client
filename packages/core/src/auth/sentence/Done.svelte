<script lang="ts">
	import { m } from '$paraglide/messages.js';

	let {
		text,
		mono = false,
		secret = false,
		disabled = false,
		onedit
	}: {
		text: string;
		mono?: boolean;
		secret?: boolean;
		disabled?: boolean;
		onedit?: () => void;
	} = $props();

	const shown = $derived(secret ? '••••••••' : text);
</script>

{#if onedit}
	<button
		type="button"
		class="done"
		class:mono={mono || secret}
		{disabled}
		title={m.auth_sentence_change()}
		aria-label={secret ? m.auth_sentence_change_password() : m.auth_sentence_change_value({ value: text })}
		onclick={onedit}>{shown}</button
	>
{:else}
	<span class="done" class:mono={mono || secret}>{shown}</span>
{/if}
