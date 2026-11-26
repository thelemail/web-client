<script lang="ts">
	let {
		value = $bindable(''),
		id,
		label,
		invalid = false,
		describedby,
		disabled = false,
		focus = false,
		onedit,
		onenter
	}: {
		value?: string;
		id: string;
		label: string;
		invalid?: boolean;
		describedby?: string;
		disabled?: boolean;
		focus?: boolean;
		onedit?: () => void;
		onenter?: () => void;
	} = $props();

	let input: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (focus && input && !disabled) input.focus();
	});
</script>

<div class="af-otp" class:bad={invalid}>
	{#each [0, 1, 2, 3, 4, 5] as i (i)}
		<div class="af-cell" class:on={i === Math.min(value.length, 5)} aria-hidden="true">{value[i] ?? ''}</div>
	{/each}
	<input
		bind:this={input}
		{id}
		{value}
		{disabled}
		inputmode="numeric"
		autocomplete="one-time-code"
		maxlength={6}
		spellcheck="false"
		aria-label={label}
		aria-invalid={invalid || undefined}
		aria-describedby={describedby}
		oninput={(e) => {
			value = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
			e.currentTarget.value = value;
			onedit?.();
		}}
		onkeydown={(e) => {
			if (e.key === 'Enter' && onenter) {
				e.preventDefault();
				onenter();
			}
		}}
	/>
</div>
