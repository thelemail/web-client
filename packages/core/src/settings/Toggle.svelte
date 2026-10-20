<script lang="ts">
	import { getRowNames } from './a11y';

	interface Props {
		on: boolean;
		onChange: (value: boolean) => void;
		label?: string;
		disabled?: boolean;
	}

	let { on, onChange, label, disabled = false }: Props = $props();

	const row = getRowNames();
</script>

<button
	type="button"
	class="toggle"
	class:on
	role="switch"
	aria-checked={on}
	aria-label={label}
	aria-labelledby={label ? undefined : row?.labelId}
	aria-describedby={row?.descId}
	{disabled}
	onclick={() => onChange(!on)}
></button>
