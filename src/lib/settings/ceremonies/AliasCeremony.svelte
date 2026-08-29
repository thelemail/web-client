<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import Plus from '@lucide/svelte/icons/plus';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CeremonyShell from '../CeremonyShell.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import Select from '../Select.svelte';
	import type { CeremonyKind } from '../data';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { ownershipProven } from '$lib/settings/domains/steps';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { aliases } from '$lib/stores/aliases.svelte';
	import { aliasKeys } from '$lib/stores/aliasKeys.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { keystore } from '$lib/keystore/keystore-client';
	import { lookupAccount } from '$lib/api/accounts';
	import { verifyDirectoryLookup, DirectoryVerificationError } from '$lib/directory/verify';
	import { createWorkspaceAlias } from '$lib/api/aliases';
	import type { SharedAlias, SharedAliasMemberGrant } from '$lib/api/aliases';

	interface Props {
		mode?: 'create' | 'members';
		alias?: SharedAlias | null;
		presetDomainId?: string | null;
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { mode = 'create', alias = null, presetDomainId = null, onClose, onComplete }: Props = $props();

	const steps = mode === 'create' ? ['Address', 'People', 'Done'] : ['People', 'Done'];
	let step = $state(0);
	let local = $state('');
	let name = $state('');
	let shared = $state(mode === 'members');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let progress = $state<string | null>(null);

	const ownedDomains = $derived(customDomains.items.filter(ownershipProven));
	let userPickedDomainId = $state<string | null>(presetDomainId);

	const selectedDomain = $derived(
		ownedDomains.find((d) => d.id === userPickedDomainId) ?? ownedDomains[0] ?? null
	);
	const domainOptions = $derived(ownedDomains.map((d) => d.domain));
	const selectedDomainName = $derived(selectedDomain?.domain ?? '');

	const localOk = $derived(/^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?$/i.test(local.trim()));
	const nameOk = $derived(name.trim().length > 0);
	const full = $derived(
		alias?.email ?? (local.trim() || 'name') + '@' + (selectedDomainName || 'example.com')
	);

	const members = $derived(workspaces.members);
	let picked = $state<string[]>([]);
	let initialised = $state(false);

	$effect(() => {
		if (initialised) return;
		if (mode === 'members' && alias) {
			picked = alias.members.map((m) => m.accountId);
			initialised = true;
		} else if (members.length && auth.accountId) {
			picked = [auth.accountId];
			initialised = true;
		}
	});

	const before = $derived(alias ? alias.members.map((m) => m.accountId) : []);
	const adding = $derived(picked.filter((id) => !before.includes(id)));
	const removing = $derived(before.filter((id) => !picked.includes(id)));
	const changed = $derived(mode === 'create' || adding.length > 0 || removing.length > 0);

	function nameOf(accountId: string): string {
		const m = members.find((x) => x.accountId === accountId);
		return m?.fullName || m?.email || 'a member';
	}

	function toggle(accountId: string) {
		picked = picked.includes(accountId)
			? picked.filter((id) => id !== accountId)
			: [...picked, accountId];
	}

	function pickDomain(n: string) {
		const d = ownedDomains.find((x) => x.domain === n);
		if (d) userPickedDomainId = d.id;
	}

	// Every member's key is checked against the signed directory before the
	// alias key is wrapped to it. Skipping this would let a substituted key
	// read everything sent to the address.
	async function resolveRecipients(emails: { accountId: string; email: string }[]) {
		const out = [];
		for (const m of emails) {
			progress = `Verifying ${m.email}`;
			const lookup = await lookupAccount(m.email);
			await verifyDirectoryLookup(lookup, m.email.trim().toLowerCase());
			out.push({ accountId: m.accountId, publicKeyArmored: lookup.publicKeyArmored });
		}
		return out;
	}

	async function submitShared() {
		const ws = workspaces.workspace?.id;
		const accountId = auth.accountId;
		if (!ws || !accountId) throw new Error('no workspace');
		const targets = picked
			.map((id) => members.find((m) => m.accountId === id))
			.filter((m): m is NonNullable<typeof m> => !!m)
			.map((m) => ({ accountId: m.accountId, email: m.email }));
		if (!targets.length) throw new Error('Pick at least one person');

		const recipients = await resolveRecipients(targets);

		progress = 'Creating the address key';
		const email = alias?.email ?? `${local.trim().toLowerCase()}@${selectedDomainName}`;
		const created = await keystore.createAliasKey({
			accountId,
			email,
			displayName: alias?.name ?? name.trim(),
			recipients
		});
		if (!created.ok) {
			throw new Error(
				created.code === 'locked' ? 'Unlock your mailbox and try again' : 'Could not create the key'
			);
		}
		const grants: SharedAliasMemberGrant[] = created.grants.map((g) => ({
			accountId: g.accountId,
			memberKeyFingerprint: hexToB64(g.memberKeyFingerprintHex),
			wrappedPrivateKey: g.wrappedPrivateKeyArmored
		}));

		progress = 'Saving';
		if (mode === 'members' && alias) {
			await aliases.rotate(ws, alias.id, {
				aliasPublicKeyArmored: created.publicKeyArmored,
				keyAlgorithm: 'openpgp-curve25519-v6',
				members: grants
			});
		} else {
			await aliases.create(ws, {
				customDomainId: selectedDomain!.id,
				localPart: local.trim().toLowerCase(),
				name: name.trim(),
				aliasPublicKeyArmored: created.publicKeyArmored,
				keyAlgorithm: 'openpgp-curve25519-v6',
				members: grants
			});
		}
		await Promise.all([addresses.load(), aliasKeys.load(accountId)]);
	}

	async function submitPersonal() {
		const ws = workspaces.workspace?.id;
		if (!ws || !selectedDomain) throw new Error('no workspace');
		const assignee = picked[0];
		if (!assignee) throw new Error('Pick who this address belongs to');
		await createWorkspaceAlias(ws, {
			customDomainId: selectedDomain.id,
			localPart: local.trim().toLowerCase(),
			assigneeAccountId: assignee,
			name: name.trim() || undefined
		});
		await addresses.load();
	}

	function hexToB64(hex: string): string {
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		}
		let bin = '';
		for (const b of bytes) bin += String.fromCharCode(b);
		return btoa(bin);
	}

	async function submit() {
		if (submitting) return;
		submitting = true;
		submitError = null;
		try {
			if (shared) await submitShared();
			else await submitPersonal();
			step = steps.length - 1;
		} catch (err) {
			if (err instanceof DirectoryVerificationError) {
				submitError = `Could not verify a member's key (${err.code}). Nothing was saved.`;
			} else {
				submitError = err instanceof Error ? err.message : 'Could not save the address';
			}
		} finally {
			submitting = false;
			progress = null;
		}
	}

	const peopleStep = $derived(mode === 'create' ? 1 : 0);
	const canSubmit = $derived(
		(mode === 'members' || (localOk && nameOk && !!selectedDomain)) && picked.length > 0 && changed
	);
</script>

<CeremonyShell
	icon={Users}
	eyebrow="Addresses"
	title={mode === 'members' ? 'Manage people' : 'Add an address'}
	{steps}
	{step}
	{onClose}
>
	{#if mode === 'create' && step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					An address on a domain you own. Give it to one person, or share it with several so mail
					sent to it reaches all of them.
				</p>
			</div>
			{#if ownedDomains.length === 0}
				<div class="inline-warn">
					<CircleAlert size={15} />
					<span
						>You need a verified custom domain first. Open <b>Custom domains</b> and add one.</span
					>
				</div>
			{:else}
				<div class="field">
					<label for="alias-name">Display name</label>
					<input
						id="alias-name"
						class="tin"
						bind:value={name}
						maxlength="120"
						placeholder="e.g. Support"
						autocomplete="off"
					/>
					<div class="field-hint">This is the name people see when you write from it.</div>
				</div>
				<div class="field">
					<label for="alias-local">Address</label>
					<div class="alias-compose">
						<input
							id="alias-local"
							class="tin mono"
							bind:value={local}
							placeholder="support"
							autocomplete="off"
						/>
						<span class="ac-at">@</span>
						<Select value={selectedDomainName} options={domainOptions} onChange={pickDomain} />
					</div>
					{#if local.length > 0 && !localOk}
						<div class="field-hint bad">
							<CircleAlert size={13} />Use letters, numbers, dots, plus, underscore, or hyphens.
						</div>
					{/if}
				</div>
				<div class="field">
					<span class="lbl">Who uses it</span>
					<label class="opt-row">
						<input type="radio" name="alias-kind" checked={!shared} onchange={() => (shared = false)} />
						<span>
							<b>One person</b>
							<span class="opt-desc">Mail arrives in their mailbox and only they can write from it.</span>
						</span>
					</label>
					<label class="opt-row">
						<input type="radio" name="alias-kind" checked={shared} onchange={() => (shared = true)} />
						<span>
							<b>Shared</b>
							<span class="opt-desc"
								>Everyone you pick receives a copy and can write from it. The address gets its own
								encryption key.</span
							>
						</span>
					</label>
				</div>
				<div class="identity-preview">
					<span class="ip-label">Preview</span>
					<span class="ip-from">
						{#if name.trim()}<b>{name.trim()}</b>{/if}
						<span class="mono">&lt;{full}&gt;</span>
					</span>
				</div>
			{/if}
		</div>
	{:else if step === peopleStep}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					{#if shared}
						Everyone here receives mail sent to <span class="mono">{full}</span> and can write from
						it.
					{:else}
						Choose whose mailbox <span class="mono">{full}</span> belongs to.
					{/if}
				</p>
			</div>
			<div class="member-pick">
				{#each members as m (m.accountId)}
					<label class="opt-row">
						<input
							type={shared ? 'checkbox' : 'radio'}
							name="alias-member"
							checked={picked.includes(m.accountId)}
							onchange={() => (shared ? toggle(m.accountId) : (picked = [m.accountId]))}
						/>
						<span>
							<b>{m.fullName || m.email}</b>
							<span class="opt-desc">{m.email}</span>
						</span>
					</label>
				{/each}
			</div>

			{#if shared && changed && mode === 'members'}
				<div class="inline-warn">
					<CircleAlert size={15} />
					<span>
						Changing who is on this address gives it a new key.
						{#if adding.length}
							{adding.map(nameOf).join(', ')} will see mail that arrives from now on, not what came
							before.
						{/if}
						{#if removing.length}
							{removing.map(nameOf).join(', ')} stops receiving new mail. Mail already delivered
							stays readable to them.
						{/if}
					</span>
				</div>
			{/if}

			{#if submitError}
				<div class="field-hint bad"><CircleAlert size={13} />{submitError}</div>
			{/if}
			{#if progress}
				<div class="field-hint">{progress}…</div>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={Users}
			title={mode === 'members' ? 'People updated' : 'Address added'}
			desc={shared
				? 'Mail sent here reaches everyone on it. Pick it in the Compose From-selector to write from it.'
				: 'It is ready to send and receive. Pick it in the Compose From-selector to write from it.'}
		>
			<div class="done-pill"><span class="mono">{full}</span></div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if mode === 'create' && step === 0}
			<button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary"
				disabled={!localOk || !nameOk || !selectedDomain}
				onclick={() => (step = 1)}>Continue</button
			>
		{:else if step === peopleStep}
			<button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
			<button type="button" class="btn btn-primary" disabled={!canSubmit || submitting} onclick={submit}>
				<Plus size={15} />{submitting ? 'Saving…' : mode === 'members' ? 'Save people' : 'Add address'}
			</button>
		{:else}
			<button
				type="button"
				class="btn btn-primary"
				onclick={() => {
					onComplete('alias');
					onClose();
				}}>Done</button
			>
		{/if}
	{/snippet}
</CeremonyShell>
