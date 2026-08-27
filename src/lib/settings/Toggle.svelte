<script lang="ts">
	interface Props {
		on: boolean;
		onChange: (value: boolean) => void;
		label?: string;
	}

	let { on, onChange, label }: Props = $props();
</script>

<button
	type="button"
	class="toggle"
	class:on
	role="switch"
	aria-checked={on}
	aria-label={label}
	onclick={() => onChange(!on)}
></button>
