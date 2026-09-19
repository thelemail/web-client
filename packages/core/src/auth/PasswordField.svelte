<script lang="ts">
	import type { Snippet } from 'svelte';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import { m } from '$paraglide/messages.js';

	let {
		label,
		value = $bindable(''),
		placeholder,
		autocomplete,
		aux,
		onEnter
	}: {
		label: string;
		value: string;
		placeholder?: string;
		autocomplete?: 'current-password' | 'new-password' | 'off';
		aux?: Snippet;
		onEnter?: () => void;
	} = $props();

	let show = $state(false);
	const id = $props.id();
</script>

<div class="field">
	<div class="lab">
		<label for={id}>{label}</label>
		{#if aux}{@render aux()}{/if}
	</div>
	<div class="pw">
		<input
			{id}
			class="inp"
			type={show ? 'text' : 'password'}
			bind:value
			{placeholder}
			autocomplete={autocomplete ?? 'off'}
			onkeydown={(e) => {
				if (e.key === 'Enter' && onEnter) onEnter();
			}}
		/>
		<button
			type="button"
			class="reveal"
			aria-label={show ? m.common_hide_password() : m.common_show_password()}
			onclick={() => (show = !show)}
		>
			{#if show}
				<EyeOff size={17} strokeWidth={1.75} />
			{:else}
				<Eye size={17} strokeWidth={1.75} />
			{/if}
		</button>
	</div>
</div>
