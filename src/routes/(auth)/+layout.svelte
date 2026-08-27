<script lang="ts">
	import '$lib/auth/auth.css';
	import wordmark from '$lib/assets/logo-wordmark.svg';
	import wordmarkInverse from '$lib/assets/logo-wordmark-inverse.svg';

	let { children } = $props();
</script>

<div class="auth">
	<div class="stagebody">
		<div class="card">
			<a class="pagebrand" href="/" aria-label="Thelemail">
				<img class="wm-light" src={wordmark} alt="Thelemail" />
				<img class="wm-dark" src={wordmarkInverse} alt="" aria-hidden="true" />
			</a>
			{@render children()}
		</div>
	</div>
</div>
