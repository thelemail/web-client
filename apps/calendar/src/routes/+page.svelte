<script lang="ts">
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { appOrigin } from '$core/products';
</script>

<AuthShell>
	<div class="card">
		<h1>Open calendar from Thelemail</h1>
		<p>Calendar opens from your mailbox, which hands it the keys it needs.</p>
		<Button variant="primary" size="lg" href={appOrigin()}>Go to Thelemail</Button>
	</div>
</AuthShell>
