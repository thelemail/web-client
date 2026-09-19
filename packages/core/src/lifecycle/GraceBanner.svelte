<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Download from '@lucide/svelte/icons/download';
	import CircleArrowDown from '@lucide/svelte/icons/circle-arrow-down';
	import { m } from '$paraglide/messages.js';
	import { fmt } from './dates';
	import type { LifecycleContext } from './types';

	let {
		ctx,
		onRestore,
		onExport,
		onDowngrade,
		scheduled
	}: {
		ctx: LifecycleContext;
		onRestore: () => void;
		onExport: () => void;
		onDowngrade?: () => void;
		scheduled?: string | null;
	} = $props();
</script>

<div class="sysalerts">
	<div class="sysalert sa-warning">
		<span class="sa-ic"><Eye size={15} /></span>
		<span class="sa-tx">
			<span class="sa-pulse"></span>
			{#if scheduled}
				<span class="sa-h">{scheduled}</span>
				<span class="sa-d">{m.lc_grace_scheduled_detail()}</span>
			{:else}
				<span class="sa-h">{m.lc_grace_title()}</span>
				<span class="sa-d">
					{m.lc_grace_detail({
						count: ctx.ladder.toSuspend,
						suspend: fmt.med(ctx.dates.suspend),
						remove: fmt.med(ctx.dates.remove)
					})}
				</span>
			{/if}
		</span>
		<span class="sa-acts">
			<button class="sa-act solid" onclick={onRestore}><RotateCcw size={13} />{m.lc_grace_restore()}</button>
			{#if onDowngrade}
				<button class="sa-act ghost" onclick={onDowngrade}>
					<CircleArrowDown size={13} />{m.lc_grace_move_to_free()}
				</button>
			{/if}
			<button class="sa-act ghost" onclick={onExport}><Download size={13} />{m.lc_grace_export()}</button>
		</span>
	</div>
</div>
