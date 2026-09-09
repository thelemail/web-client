<script lang="ts">
	import AuthShell from '$lib/auth/AuthShell.svelte';

	let { children } = $props();
</script>

<AuthShell>
	<div class="card">
		{@render children()}
	</div>
</AuthShell>
