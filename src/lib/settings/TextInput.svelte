<script lang="ts">
	interface Props {
		value: string;
		onChange?: (value: string) => void;
		mono?: boolean;
		w?: 'narrow' | 'mid';
		placeholder?: string;
		type?: 'text' | 'email' | 'password' | 'date';
		disabled?: boolean;
	}

	let {
		value,
		onChange,
		mono = false,
		w,
		placeholder,
		type = 'text',
		disabled = false
	}: Props = $props();

	const classes = $derived(['tin', mono && 'mono', w && 'w-' + w].filter(Boolean).join(' '));
</script>

<input
	class={classes}
	{type}
	{value}
	{placeholder}
	{disabled}
	oninput={(e) => onChange?.((e.currentTarget as HTMLInputElement).value)}
/>
