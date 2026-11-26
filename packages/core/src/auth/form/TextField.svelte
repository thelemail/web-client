<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		value = $bindable(''),
		id,
		label,
		type = 'text',
		placeholder = '',
		mono = false,
		invalid = false,
		describedby,
		autocomplete = 'off',
		inputmode,
		maxlength,
		disabled = false,
		readonly = false,
		focus = false,
		normalize,
		suffix,
		aux
	}: {
		value?: string;
		id: string;
		label: string;
		type?: 'text' | 'email';
		placeholder?: string;
		mono?: boolean;
		invalid?: boolean;
		describedby?: string;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		inputmode?: HTMLInputAttributes['inputmode'];
		maxlength?: number;
		disabled?: boolean;
		readonly?: boolean;
		focus?: boolean;
		normalize?: (raw: string) => string;
		suffix?: Snippet;
		aux?: Snippet;
	} = $props();

	let input: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (focus && input && !disabled && !readonly) input.focus();
	});

	function onInput(e: Event & { currentTarget: HTMLInputElement }) {
		const raw = e.currentTarget.value;
		value = normalize ? normalize(raw) : raw;
		if (value !== raw) e.currentTarget.value = value;
	}
</script>

{#snippet field()}
	<input
		bind:this={input}
		{id}
		class:inp={!suffix}
		class:mono
		{type}
		{value}
		{placeholder}
		{autocomplete}
		{inputmode}
		{maxlength}
		{disabled}
		{readonly}
		spellcheck="false"
		autocapitalize="none"
		aria-invalid={invalid || undefined}
		aria-describedby={describedby}
		oninput={onInput}
	/>
{/snippet}

<div class="field">
	<div class="lab">
		<label for={id}>{label}</label>
		{#if aux}{@render aux()}{/if}
	</div>
	{#if suffix}
		<div class="af-suffixed" class:bad={invalid}>
			{@render field()}<span class="af-suffix">{@render suffix()}</span>
		</div>
	{:else}
		{@render field()}
	{/if}
</div>
