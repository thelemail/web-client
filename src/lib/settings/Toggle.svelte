<script lang="ts">
	interface Props {
		on: boolean;
		onChange: (value: boolean) => void;
		label?: string;
		disabled?: boolean;
	}

	let { on, onChange, label, disabled = false }: Props = $props();
</script>

<button
	type="button"
	class="toggle"
	class:on
	role="switch"
	aria-checked={on}
	aria-label={label}
	{disabled}
	onclick={() => onChange(!on)}
></button>
