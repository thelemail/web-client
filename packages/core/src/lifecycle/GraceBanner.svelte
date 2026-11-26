<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import {
		faCircleArrowDown,
		faDownload,
		faEye,
		faRotateLeft
	} from '@fortawesome/pro-regular-svg-icons';
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
		<span class="sa-ic"><Icon icon={faEye} size={15} /></span>
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
			<Button variant="primary" size="sm" class="sa-act" onclick={onRestore}><Icon icon={faRotateLeft} size={13} />{m.lc_grace_restore()}</Button>
			{#if onDowngrade}
				<Button variant="neutral" size="sm" class="sa-act" onclick={onDowngrade}>
					<Icon icon={faCircleArrowDown} size={13} />{m.lc_grace_move_to_free()}
				</Button>
			{/if}
			<Button variant="neutral" size="sm" class="sa-act" onclick={onExport}><Icon icon={faDownload} size={13} />{m.lc_grace_export()}</Button>
		</span>
	</div>
</div>
