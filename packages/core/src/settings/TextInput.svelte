<script lang="ts">
	import { getRowNames } from './a11y';

	interface Props {
		value: string;
		onChange?: (value: string) => void;
		mono?: boolean;
		w?: 'narrow' | 'mid';
		placeholder?: string;
		type?: 'text' | 'email' | 'password' | 'date';
		disabled?: boolean;
		id?: string;
		label?: string;
	}

	let {
		value,
		onChange,
		mono = false,
		w,
		placeholder,
		type = 'text',
		disabled = false,
		id,
		label
	}: Props = $props();

	const row = getRowNames();
	const classes = $derived(['tin', mono && 'mono', w && 'w-' + w].filter(Boolean).join(' '));
</script>

<input
	{id}
	class={classes}
	{type}
	{value}
	{placeholder}
	{disabled}
	aria-label={label}
	aria-labelledby={label || id ? undefined : row?.labelId}
	aria-describedby={row?.descId}
	oninput={(e) => onChange?.((e.currentTarget as HTMLInputElement).value)}
/>
