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
	<div class="card">
		<div class="card-surface">
			<div class="card-head">
				<p class="eyebrow">{status}</p>
				<h1>{heading}</h1>
				<p>{message}</p>
			</div>
			<Button variant="primary" size="lg" block href="/">{m.app_error_go_to_mailbox()}</Button>
			<p class="af-row"><a href="https://thelemail.com">thelemail.com</a></p>
		</div>
	</div>
</AuthShell>
