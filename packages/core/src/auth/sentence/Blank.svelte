<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { m } from '$paraglide/messages.js';

	let {
		value = $bindable(''),
		id,
		label,
		placeholder = '',
		size = 3,
		mono = false,
		secret = false,
		invalid = false,
		describedby,
		autocomplete = 'off',
		inputmode,
		maxlength,
		disabled = false,
		focus = false,
		normalize,
		onenter,
		onpaste,
		suffix
	}: {
		value?: string;
		id: string;
		label: string;
		placeholder?: string;
		size?: number;
		mono?: boolean;
		secret?: boolean;
		invalid?: boolean;
		describedby?: string;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		inputmode?: HTMLInputAttributes['inputmode'];
		maxlength?: number;
		disabled?: boolean;
		focus?: boolean;
		normalize?: (raw: string) => string;
		onenter?: () => void;
		onpaste?: (e: ClipboardEvent) => void;
		suffix?: Snippet;
	} = $props();

	let show = $state(false);
	let input: HTMLInputElement | undefined = $state();
	const width = $derived(`${Math.max(secret && !show ? 0 : value.length, placeholder.length, size) + 0.4}ch`);

	$effect(() => {
		if (focus && input && !disabled) input.focus();
	});
</script>

<span class="blank" class:mono class:bad={invalid}>
	<input
		bind:this={input}
		{id}
		type={secret && !show ? 'password' : 'text'}
		{value}
		{placeholder}
		{autocomplete}
		{inputmode}
		{maxlength}
		{disabled}
		spellcheck="false"
		autocapitalize="none"
		aria-label={label}
		aria-invalid={invalid || undefined}
		aria-describedby={describedby}
		style:width
		oninput={(e) => (value = normalize ? normalize(e.currentTarget.value) : e.currentTarget.value)}
		onkeydown={(e) => {
			if (e.key === 'Enter' && onenter) {
				e.preventDefault();
				onenter();
			}
		}}
		{onpaste}
	/>
	{#if suffix}<span class="blank-suffix">{@render suffix()}</span>{/if}
	{#if secret}
		<button
			type="button"
			class="blank-eye"
			{disabled}
			aria-pressed={show}
			aria-label={show ? m.common_hide_password() : m.common_show_password()}
			onclick={() => (show = !show)}
		>
			{show ? m.auth_sentence_hide() : m.auth_sentence_show()}
		</button>
	{/if}
</span>
