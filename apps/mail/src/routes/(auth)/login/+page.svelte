<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import LoginFlow from '$core/auth/LoginFlow.svelte';
	import { resolveReturnTo } from '$core/auth/return-to';
</script>

<LoginFlow afterSignIn={(slot) => goto(resolveReturnTo(page.url.searchParams.get('redirect'), slot))} />
