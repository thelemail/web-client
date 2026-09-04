<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { Button } from '$lib/components/ui/button';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import { cal } from '../state.svelte';
	import MirrorsTable from './MirrorsTable.svelte';
	import PrivacyModeCards from './PrivacyModeCards.svelte';
	import SuggestionRules from './SuggestionRules.svelte';
	import type { BoundaryLine } from '../types';

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
			<div class="eyebrow">Availability &amp; mirroring</div>
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

		<div class="card">
			<div class="card-h">
				<div>
					<div class="ch-t">Busy-only mirrors</div>
					<div class="ch-s">
						One truthful schedule across identities, without one merged calendar. Nothing here
						copies titles.
					</div>
				</div>
				<Button variant="secondary" size="sm" onclick={() => cal.unbuilt()}>Add a mirror</Button>
			</div>
			<div class="card-b tight">
				<MirrorsTable />
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
				<SuggestionRules />
			</div>
		</div>
	</div>
</div>
