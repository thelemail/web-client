<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { m } from '$paraglide/messages.js';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import AvailabilityGrid from './AvailabilityGrid.svelte';
	import PrivacyModeCards from './PrivacyModeCards.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import type { BoundaryLine } from '../types';

	const gridBoundary: BoundaryLine[] = $derived([
		{
			tone: 'yes',
			text: m.cal_availview_grid_published(),
			mono: m.cal_availview_grid_server_reads()
		},
		{
			tone: 'no',
			text: m.cal_availview_grid_private()
		},
		{
			tone: 'yes',
			text: m.cal_availview_grid_signed()
		}
	]);

	const alone = $derived(workspaces.members.length <= 1);

	const limits: BoundaryLine[] = $derived([
		{
			tone: 'warn',
			text: m.cal_availview_limit_envelope()
		},
		{
			tone: 'warn',
			text: m.cal_availview_limit_mirroring()
		},
		{
			tone: 'no',
			text: m.cal_availview_limit_caldav()
		}
	]);
</script>

<div class="page">
	<div class="page-inner">
		<div class="page-h">
			<div class="eyebrow">{m.cal_availview_eyebrow()}</div>
			<h1>{m.cal_availview_title()}</h1>
			<p>{m.cal_availview_desc()}</p>
		</div>

		<div class="card">
			<div class="card-h">
				<div>
					<div class="ch-t">{m.cal_availview_busy_title()}</div>
					<div class="ch-s">{m.cal_availview_busy_desc()}</div>
				</div>
			</div>
			<div class="card-b">
				<AvailabilityGrid />
				{#if alone}
					<div class="avail-solo">{m.cal_availview_solo()}</div>
				{/if}
				<div class="limits">
					<DisclosureBoundary
						heading={m.cal_boundary_heading_device()}
						headingIcon={ShieldCheck}
						lines={gridBoundary}
						noIcon="x"
					/>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="card-h">
				<div>
					<div class="ch-t">{m.cal_availview_default_title()}</div>
					<div class="ch-s">{m.cal_availview_default_desc()}</div>
				</div>
			</div>
			<div class="card-b">
				<PrivacyModeCards />
				<div class="limits">
					<DisclosureBoundary
						heading={m.cal_availview_cannot_protect()}
						headingIcon={ShieldAlert}
						lines={limits}
						noIcon="x"
					/>
				</div>
			</div>
		</div>

		{#if import.meta.env.DEV}
		<div class="card">
			<div class="card-h">
				<div>
					<div class="ch-t">{m.cal_availview_mirrors_title()}</div>
					<div class="ch-s">{m.cal_availview_mirrors_desc()}</div>
				</div>
			</div>
			<div class="card-b tight">
				{#await import('../preview/availability/MirrorsTable.svelte') then mod}
					<mod.default />
				{/await}
			</div>
		</div>

		<div class="card">
			<div class="card-h">
				<div>
					<div class="ch-t">{m.cal_availview_suggest_title()}</div>
					<div class="ch-s">{m.cal_availview_suggest_desc()}</div>
				</div>
			</div>
			<div class="card-b tight">
				{#await import('../preview/availability/SuggestionRules.svelte') then mod}
					<mod.default />
				{/await}
			</div>
		</div>
		{/if}
	</div>
</div>
