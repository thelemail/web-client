<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import { faEye, faEyeSlash } from '@fortawesome/pro-regular-svg-icons';
	import { m } from '$paraglide/messages.js';

	let {
		id: givenId,
		label,
		value = $bindable(''),
		placeholder,
		autocomplete,
		aux,
		onEnter,
		invalid = false,
		describedby,
		focusOnMount = false,
		focus = false,
		mono = true,
		disabled = false
	}: {
		id?: string;
		label: string;
		value: string;
		placeholder?: string;
		autocomplete?: 'current-password' | 'new-password' | 'off';
		aux?: Snippet;
		onEnter?: () => void;
		invalid?: boolean;
		describedby?: string;
		focusOnMount?: boolean;
		focus?: boolean;
		mono?: boolean;
		disabled?: boolean;
	} = $props();

	let show = $state(false);
	let input: HTMLInputElement | undefined = $state();
	const fallbackId = $props.id();
	const id = $derived(givenId ?? fallbackId);

	$effect(() => {
		if (focus && input && !disabled) input.focus();
	});
</script>

<div class="field">
	<div class="lab">
		<label for={id}>{label}</label>
		{#if aux}{@render aux()}{/if}
	</div>
	<div class="pw">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:this={input}
			{id}
			class="inp"
			class:mono
			type={show ? 'text' : 'password'}
			bind:value
			{placeholder}
			autocomplete={autocomplete ?? 'off'}
			aria-invalid={invalid || undefined}
			aria-describedby={describedby}
			autofocus={focusOnMount}
			{disabled}
			onkeydown={(e) => {
				if (e.key === 'Enter' && onEnter) {
					e.preventDefault();
					onEnter();
				}
			}}
		/>
		<button
			type="button"
			class="reveal"
			{disabled}
			aria-label={show ? m.common_hide_password() : m.common_show_password()}
			onclick={() => (show = !show)}
		>
			{#if show}
				<Icon icon={faEyeSlash} size={17} />
			{:else}
				<Icon icon={faEye} size={17} />
			{/if}
		</button>
	</div>
</div>
