<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import HandoffCard from '$core/auth/form/HandoffCard.svelte';
	import { hasPendingAuthorize } from '$core/producthandoff/pending';
	import { mailStartUrl, productHost } from '$core/products';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();

	function go() {
		if (hasPendingAuthorize()) void goto('/authorize', { replace: true });
		else window.location.replace(mailStartUrl(data.accountId, data.slot));
	}

	onMount(go);
</script>

<AuthShell strip={false}>
	<div class="card">
		<HandoffCard
			title={m.handoff_open_mail_title()}
			lede={m.handoff_open_mail_lede({ host: productHost('app') })}
			to={productHost('app')}
			secure="from"
			retry={go}
		/>
	</div>
</AuthShell>
