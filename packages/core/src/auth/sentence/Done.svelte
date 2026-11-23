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
	const at = $derived(mono && !secret ? shown.indexOf('@') : -1);
</script>

{#if onedit}
	<button
		type="button"
		class="sp-filled"
		class:mono={mono || secret}
		{disabled}
		title={m.auth_sentence_change()}
		aria-label={secret ? m.auth_sentence_change_password() : m.auth_sentence_change_value({ value: text })}
		onclick={onedit}>{#if at > 0}{shown.slice(0, at + 1)}<wbr />{shown.slice(at + 1)}{:else}{shown}{/if}</button
	>
{:else}
	<span class="sp-filled" class:mono={mono || secret}
		>{#if at > 0}{shown.slice(0, at + 1)}<wbr />{shown.slice(at + 1)}{:else}{shown}{/if}</span
	>
{/if}
