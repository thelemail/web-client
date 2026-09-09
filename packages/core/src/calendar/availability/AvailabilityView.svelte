<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import AvailabilityGrid from './AvailabilityGrid.svelte';
	import PrivacyModeCards from './PrivacyModeCards.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import type { BoundaryLine } from '../types';

	const GRID_BOUNDARY: BoundaryLine[] = [
		{
			tone: 'yes',
			text: 'These blocks are the busy windows your workspace publishes. Titles, guests and locations are not part of them and never left anyone’s device.',
			mono: 'server reads: start, end'
		},
		{
			tone: 'no',
			text: 'Items set to Private publish nothing. An empty row does not mean a free person.'
		},
		{
			tone: 'yes',
			text: 'Each block is signed by the account that published it. Blocks we could not check are marked.'
		}
	];

	const alone = $derived(workspaces.members.length <= 1);

	const LIMITS: BoundaryLine[] = [
		{
			tone: 'warn',
			text: 'Invitations are mail. Envelope metadata — who you invited and when — is visible, as it is for any mail. We don’t pretend otherwise.'
		},
		{
			tone: 'warn',
			text: 'Busy-only mirroring necessarily reveals that a window is taken. It never reveals by what.'
		},
		{
			tone: 'no',
			text: 'Direct CalDAV is not offered yet. It cannot be honest about zero-access storage without a local bridge, so it is listed as coming rather than shipped.'
		}
	];
</script>

<div class="page">
	<div class="page-inner">
		<div class="page-h">
			<div class="eyebrow">Availability</div>
			<h1>Say exactly what leaves.</h1>
			<p>
				One switch called “private” would be a lie. A calendar has to disclose something to be
				useful, so the mode is a property of each relationship — and every row below states what the
				other side can read.
			</p>
		</div>

		<div class="card">
			<div class="card-h">
				<div>
					<div class="ch-t">Who is busy this week</div>
					<div class="ch-s">
						Busy windows only, with no titles. This is what the server can see about each of you.
					</div>
				</div>
			</div>
			<div class="card-b">
				<AvailabilityGrid />
				{#if alone}
					<div class="avail-solo">
						Availability across people needs more than one person in this workspace.
					</div>
				{/if}
				<div class="limits">
					<DisclosureBoundary
						heading="What leaves this device"
						headingIcon={ShieldCheck}
						lines={GRID_BOUNDARY}
						noIcon="x"
					/>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="card-h">
				<div>
					<div class="ch-t">Default mode for new commitments</div>
					<div class="ch-s">
						Applies to anything you create without choosing otherwise. Changing it never rewrites
						existing events.
					</div>
				</div>
			</div>
			<div class="card-b">
				<PrivacyModeCards />
				<div class="limits">
					<DisclosureBoundary
						heading="What we cannot protect"
						headingIcon={ShieldAlert}
						lines={LIMITS}
						noIcon="x"
					/>
				</div>
			</div>
		</div>

		{#if import.meta.env.DEV}
		<div class="card">
			<div class="card-h">
				<div>
					<div class="ch-t">Busy-only mirrors</div>
					<div class="ch-s">
						One truthful schedule across identities, without one merged calendar. Nothing here
						copies titles.
					</div>
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
					<div class="ch-t">How times get suggested</div>
					<div class="ch-s">Every rule here is visible to you and invisible to the person booking.</div>
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
