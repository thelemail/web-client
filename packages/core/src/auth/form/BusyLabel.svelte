<script lang="ts">
	let { busy, label, pending }: { busy: boolean; label: string; pending: string } = $props();
</script>

<span class="af-busy" class:on={busy} data-alt={busy ? label : pending}
	><span>{#if busy}<span class="spinner"></span>{pending}{:else}{label}{/if}</span></span
>
