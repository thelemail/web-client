<script lang="ts">
	import { page } from '$app/state';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { Button } from '$core/components/ui/button';

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? 'Something went wrong loading this page.');
	const heading = $derived(status === 404 ? 'Page not found' : 'This page did not load');
</script>

<AuthShell>
	<div class="card errcard">
		<p class="errcode">{status}</p>
		<h1>{heading}</h1>
		<p class="errmsg">{message}</p>
		<div class="erracts">
			<Button variant="primary" size="lg" href="/">Go to your mailbox</Button>
			<Button variant="ghost" size="lg" href="https://thelemail.com">thelemail.com</Button>
		</div>
	</div>
</AuthShell>
