<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { platform } from '$platform';
	import { faHardDrive } from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';

	interface Props {
		accountId: string;
	}

	let { accountId }: Props = $props();

	let asking = $state(false);
	let busy = $state(false);

	$effect(() => {
		const mirror = platform.mirror;
		if (!mirror) return;
		let cancelled = false;
		void mirror
			.scope(accountId)
			.then((chosen) => {
				if (!cancelled) asking = chosen === null;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	async function choose(days: number | null) {
		const mirror = platform.mirror;
		if (!mirror || busy) return;
		busy = true;
		const floor =
			days === null
				? 'all'
				: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
		try {
			await mirror.setScope(accountId, floor);
			asking = false;
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root open={asking}>
	<Dialog.Content showCloseButton={false} escapeKeydownBehavior="ignore" interactOutsideBehavior="ignore">
		<Dialog.Header icon={faHardDrive}>
			<Dialog.Title>{m.mail_mirror_scope_title()}</Dialog.Title>
			<Dialog.Description>{m.mail_mirror_scope_body()}</Dialog.Description>
		</Dialog.Header>
		<p class="dialog-hint">{m.mail_mirror_scope_note()}</p>
		<Dialog.Footer>
			<Button variant="tonal" disabled={busy} onclick={() => choose(null)}>
				{m.mail_mirror_scope_all()}
			</Button>
			<Button variant="primary" disabled={busy} onclick={() => choose(90)}>
				{m.mail_mirror_scope_90_days()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
