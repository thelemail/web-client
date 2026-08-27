<script lang="ts">
	import Inbox from '@lucide/svelte/icons/inbox';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CardHead from '../CardHead.svelte';
	import Row from '../Row.svelte';
	import Toggle from '../Toggle.svelte';
	import Select from '../Select.svelte';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { customDomains } from '$lib/stores/customDomains.svelte';

	const NONE_VALUE = '';

	let error = $state<string | null>(null);
	let busy = $state(false);

	const verifiedDomainIds = $derived(
		customDomains.items.filter((d) => d.status === 'verified').map((d) => d.id)
	);
	const eligibleAddresses = $derived(
		addresses.items.filter(
			(a) => a.customDomainId && verifiedDomainIds.includes(a.customDomainId)
		)
	);

	const catchAllId = $derived(workspaces.workspace?.catchAllAddressId ?? null);
	const enabled = $derived(catchAllId !== null);
	const currentTarget = $derived(
		catchAllId ? eligibleAddresses.find((a) => a.id === catchAllId) ?? null : null
	);

	const options = $derived(eligibleAddresses.map((a) => identityLabel(a.name, a.email)));
	const value = $derived(currentTarget ? identityLabel(currentTarget.name, currentTarget.email) : '');

	function identityLabel(name: string | null | undefined, email: string): string {
		if (name && name.trim()) return `${name.trim()} — ${email}`;
		return email;
	}

	async function onToggle(on: boolean) {
		if (busy) return;
		error = null;
		busy = true;
		try {
			if (on) {
				const target = currentTarget ?? eligibleAddresses[0];
				if (!target) {
					error = 'Add an address on a verified domain first.';
					return;
				}
				await workspaces.setCatchAll(target.id);
			} else {
				await workspaces.setCatchAll(null);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not update catch-all';
		} finally {
			busy = false;
		}
	}

	async function onTargetChange(label: string) {
		const match = eligibleAddresses.find((a) => identityLabel(a.name, a.email) === label);
		if (!match) return;
		error = null;
		busy = true;
		try {
			await workspaces.setCatchAll(match.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not update catch-all target';
		} finally {
			busy = false;
		}
	}
</script>

<div class="scard">
	<CardHead icon={Inbox} title="Catch-all" />
	{#if eligibleAddresses.length === 0}
		<div class="setrow">
			<div class="info">
				<div class="t">Route unmatched addresses</div>
				<div class="d">
					Add an address on a verified custom domain before enabling catch-all.
				</div>
			</div>
		</div>
	{:else}
		<Row
			t="Route unmatched mail for this workspace"
			d="Deliver mail sent to any address on your workspace’s verified domains that doesn’t match a mailbox straight to one chosen inbox."
		>
			<Toggle on={enabled} onChange={onToggle} />
		</Row>
		{#if enabled}
			<Row t="Deliver to" d="Catch-all messages land in this address’s mailbox.">
				<Select value={value} options={options} onChange={onTargetChange} />
			</Row>
		{/if}
	{/if}
	{#if error}
		<div class="setrow"><div class="info"><div class="ca-err"><CircleAlert size={14} />{error}</div></div></div>
	{/if}
</div>

<style>
	.ca-err {
		color: var(--warn, #b25030);
		display: inline-flex;
		gap: 6px;
		align-items: center;
		font-size: 12.5px;
	}
</style>
