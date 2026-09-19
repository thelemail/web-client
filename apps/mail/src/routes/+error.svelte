<script lang="ts">
	import { page } from '$app/state';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? m.app_error_default_message());
	const heading = $derived(status === 404 ? m.app_error_not_found_title() : m.app_error_failed_title());
</script>

<AuthShell>
	<div class="card errcard">
		<p class="errcode">{status}</p>
		<h1>{heading}</h1>
		<p class="errmsg">{message}</p>
		<div class="erracts">
			<Button variant="primary" size="lg" href="/">{m.app_error_go_to_mailbox()}</Button>
			<Button variant="ghost" size="lg" href="https://thelemail.com">thelemail.com</Button>
		</div>
	</div>
</AuthShell>
