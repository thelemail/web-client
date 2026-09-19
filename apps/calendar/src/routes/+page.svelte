<script lang="ts">
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { appOrigin } from '$core/products';
	import { m } from '$paraglide/messages.js';
</script>

<AuthShell>
	<div class="card">
		<h1>{m.cal_app_open_title()}</h1>
		<p>{m.cal_app_open_desc()}</p>
		<Button variant="primary" size="lg" href={appOrigin()}>{m.cal_app_go_to_thelemail()}</Button>
	</div>
</AuthShell>
