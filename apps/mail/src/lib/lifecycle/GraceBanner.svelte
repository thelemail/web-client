<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Download from '@lucide/svelte/icons/download';
	import { fmt } from './dates';
	import type { LifecycleContext } from './types';

	let {
		ctx,
		onRestore,
		onExport
	}: { ctx: LifecycleContext; onRestore: () => void; onExport: () => void } = $props();
</script>

<div class="sysalerts">
	<div class="sysalert sa-warning">
		<span class="sa-ic"><Eye size={15} /></span>
		<span class="sa-tx">
			<span class="sa-pulse"></span>
			<span class="sa-h">Read-only · still receiving mail.</span>
			<span class="sa-d">
				Becomes inactive {fmt.med(ctx.dates.suspend)} · {ctx.ladder.toSuspend} days left · your mail is
				safe until {fmt.med(ctx.dates.remove)}.
			</span>
		</span>
		<span class="sa-acts">
			<button class="sa-act solid" onclick={onRestore}><RotateCcw size={13} />Restore</button>
			<button class="sa-act ghost" onclick={onExport}><Download size={13} />Export</button>
		</span>
	</div>
</div>
