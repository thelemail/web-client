<script lang="ts">
	import Inbox from '@lucide/svelte/icons/inbox';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CardHead from '../CardHead.svelte';
	import Row from '../Row.svelte';
	import Toggle from '../Toggle.svelte';
	import Select from '../Select.svelte';
	import { addresses } from '$core/stores/addresses.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { ownershipProven } from '$core/settings/domains/steps';
	import { m } from '$paraglide/messages.js';

	const NONE_VALUE = '';

	let error = $state<string | null>(null);
	let busy = $state(false);

	const ownedDomainIds = $derived(customDomains.items.filter(ownershipProven).map((d) => d.id));
	const eligibleAddresses = $derived(
		addresses.items.filter(
			(a) => a.customDomainId && ownedDomainIds.includes(a.customDomainId)
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
					error = m.settings_catchall_need_address();
					return;
				}
				await workspaces.setCatchAll(target.id);
			} else {
				await workspaces.setCatchAll(null);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : m.settings_catchall_update_failed();
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
			error = err instanceof Error ? err.message : m.settings_catchall_target_failed();
		} finally {
			busy = false;
		}
	}
</script>

<div class="scard">
	<CardHead icon={Inbox} title={m.settings_catchall_title()} />
	{#if eligibleAddresses.length === 0}
		<div class="setrow">
			<div class="info">
				<div class="t">{m.settings_catchall_route_addresses()}</div>
				<div class="d">
					{m.settings_catchall_route_addresses_desc()}
				</div>
			</div>
		</div>
	{:else}
		<Row
			t={m.settings_catchall_route_mail()}
			d={m.settings_catchall_route_mail_desc()}
		>
			<Toggle on={enabled} onChange={onToggle} />
		</Row>
		{#if enabled}
			<Row t={m.settings_catchall_deliver_to()} d={m.settings_catchall_deliver_to_desc()}>
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
		color: var(--warning-700);
		display: inline-flex;
		gap: 6px;
		align-items: center;
		font-size: 12.5px;
	}
</style>
