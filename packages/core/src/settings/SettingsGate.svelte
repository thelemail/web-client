<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$core/components/ui/button';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
	import { m } from '$paraglide/messages.js';

	type Control = 'select' | 'toggle';

	interface Props {
		controls: Control[];
		children: Snippet;
	}

	let { controls, children }: Props = $props();
</script>

{#if accountSettings.status === 'ready'}
	{@render children()}
{:else if accountSettings.status === 'error'}
	<div class="setrow set-loaderr" role="alert">
		<CircleAlert size={16} />
		<p>{m.settings_load_failed()}</p>
		<Button variant="secondary" size="sm" onclick={settingsDraft.retryLoad}>
			<RefreshCw />{m.common_retry()}
		</Button>
	</div>
{:else}
	<div class="set-skel" aria-busy="true">
		<span class="sr-only">{m.common_loading()}</span>
		{#each controls as control, i (i)}
			<div class="setrow" aria-hidden="true">
				<div class="info">
					<span class="sk-bar sk-t"></span>
					<span class="sk-bar sk-d"></span>
				</div>
				<div class="ctl"><span class="sk-bar sk-c {control}"></span></div>
			</div>
		{/each}
	</div>
{/if}
