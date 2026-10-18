<script lang="ts">
	import { page } from '$app/state';
	import { confirmForwarding } from '$core/api/readDelegations';
	import { ApiCallError } from '$core/api/types';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

	type Outcome = 'done' | 'already' | 'expired' | 'invalid' | 'unavailable' | 'error';

	const token = $derived(page.url.searchParams.get('token') ?? '');

	let working = $state(false);
	let outcome = $state<Outcome | null>(null);

	function outcomeFor(err: unknown): Outcome {
		if (!(err instanceof ApiCallError)) return 'error';
		switch (err.envelope?.error?.code) {
			case 'confirmation_link_expired':
				return 'expired';
			case 'confirmation_link_invalid':
				return 'invalid';
			case 'forwarding_source_unavailable':
				return 'unavailable';
			default:
				return 'error';
		}
	}

	async function confirm() {
		if (working || !token) return;
		working = true;
		try {
			const res = await confirmForwarding(token);
			outcome = res.alreadyConfirmed ? 'already' : 'done';
		} catch (err) {
			outcome = outcomeFor(err);
		} finally {
			working = false;
		}
	}

	const terminal = $derived.by(() => {
		switch (outcome) {
			case 'done':
				return { title: m.auth_forwarding_confirm_done_title(), body: m.auth_forwarding_confirm_done_body() };
			case 'already':
				return { title: m.auth_forwarding_confirm_already_title(), body: m.auth_forwarding_confirm_already_body() };
			case 'expired':
				return { title: m.auth_forwarding_confirm_expired_title(), body: m.auth_forwarding_confirm_expired_body() };
			case 'invalid':
				return { title: m.auth_forwarding_confirm_invalid_title(), body: m.auth_forwarding_confirm_invalid_body() };
			case 'unavailable':
				return {
					title: m.auth_forwarding_confirm_unavailable_title(),
					body: m.auth_forwarding_confirm_unavailable_body()
				};
			default:
				return null;
		}
	});
</script>

<svelte:head>
	<title>{m.auth_forwarding_confirm_page_title()}</title>
</svelte:head>

<div class="card-surface screen-fade">
	{#if !token}
		<div class="card-head">
			<p class="eyebrow">{m.auth_forwarding_confirm_eyebrow()}</p>
			<h1>{m.auth_forwarding_confirm_missing_title()}</h1>
			<p>{m.auth_forwarding_confirm_missing_body()}</p>
		</div>
	{:else if terminal}
		<div class="card-head">
			<p class="eyebrow">{m.auth_forwarding_confirm_eyebrow()}</p>
			<h1>{terminal.title}</h1>
			<p>{terminal.body}</p>
		</div>
	{:else}
		<div class="card-head">
			<p class="eyebrow">{m.auth_forwarding_confirm_eyebrow()}</p>
			{#if outcome === 'error'}
				<h1>{m.auth_forwarding_confirm_error_title()}</h1>
				<p>{m.auth_forwarding_confirm_error_body()}</p>
			{:else}
				<h1>{m.auth_forwarding_confirm_title()}</h1>
				<p>{m.auth_forwarding_confirm_body()}</p>
			{/if}
		</div>
		<div class="actions" style="margin-top:24px">
			<Button variant="primary" size="lg" block disabled={working} aria-busy={working} onclick={confirm}>
				{#if working}
					{m.auth_forwarding_confirm_working()}
				{:else if outcome === 'error'}
					{m.common_retry()}
				{:else}
					{m.auth_forwarding_confirm_button()}
				{/if}
			</Button>
		</div>
	{/if}
</div>
