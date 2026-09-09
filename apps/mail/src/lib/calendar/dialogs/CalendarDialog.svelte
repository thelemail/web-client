<script lang="ts">
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import { lookupAccount } from '$core/api/accounts';
	import {
		createCalendar,
		rotateCalendarMembers,
		updateCalendar,
		type CalendarMemberGrant,
		type CalendarRole
	} from '$core/api/calendars';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { verifyDirectoryLookup } from '$lib/directory/verify';
	import { hexToB64, textToB64 } from '$lib/keys/encode';
	import { keystore } from '$core/keystore/keystore-client';
	import { senderKey } from '$lib/mail/send';
	import { bytesToB64 } from '$lib/crypto';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { calendarKeys } from '$lib/stores/calendarKeys.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import { META_SCHEMA_VERSION, serializeMeta, type CalendarMeta, type Privacy } from '../model';
	import { sealText, type SealKey } from '../seal';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';
	import type { BoundaryLine, CalendarDialogRequest } from '../types';

	interface Props {
		request: CalendarDialogRequest;
	}

	let { request }: Props = $props();

	const PALETTE = ['#2E5440', '#A87C3D', '#3C6E8C', '#9B5B4E', '#6E5B9E', '#4E8073', '#6B7360', '#7E6BA8'];
	const KEY_ALGORITHM = 'openpgp-curve25519-v6';

	const existing = $derived(request.calendarId ? calendarStore.calendar(request.calendarId) : undefined);

	let kind = $state<'personal' | 'shared' | 'role'>('personal');
	let name = $state('');
	let color = $state(PALETTE[0]);
	let description = $state('');
	let defaultPrivacy = $state<Privacy>('busy');
	let aliasAddressId = $state('');
	let roles = $state<Record<string, CalendarRole | null>>({});
	let busy = $state(false);
	let progress = $state('');
	let error = $state<string | null>(null);
	let initialised = false;

	$effect(() => {
		if (initialised) return;
		initialised = true;
		if (existing) {
			kind = existing.kind;
			name = existing.meta?.name ?? '';
			color = existing.meta?.color ?? PALETTE[0];
			description = existing.meta?.description ?? '';
			defaultPrivacy = existing.meta?.defaultPrivacy ?? 'busy';
			const next: Record<string, CalendarRole | null> = {};
			for (const m of existing.row.members) next[m.accountId] = m.role;
			roles = next;
		} else if (auth.accountId) {
			roles = { [auth.accountId]: 'owner' };
		}
	});

	const members = $derived(workspaces.members);
	const canShare = $derived(members.length > 1);
	const sharedAddresses = $derived(addresses.shared);
	const isAdmin = $derived(workspaces.canManage(auth.accountId));

	const title = $derived(
		request.mode === 'create'
			? 'New calendar'
			: request.mode === 'share'
				? 'Members and key'
				: request.mode === 'delete'
					? 'Delete calendar'
					: 'Calendar settings'
	);

	const boundary = $derived.by((): BoundaryLine[] => {
		if (kind === 'personal') {
			return [
				{ tone: 'yes', text: 'Sealed to your own key. Nobody else can open a single field.' },
				{ tone: 'no', text: 'The server keeps the calendar id and when it changes, nothing more.' }
			];
		}
		if (kind === 'role') {
			return [
				{ tone: 'yes', text: 'Sealed to the shared address key its members already hold.' },
				{ tone: 'warn', text: 'Whoever can read the address can read this calendar. Membership follows the address.' }
			];
		}
		const count = Object.values(roles).filter(Boolean).length;
		return [
			{ tone: 'yes', text: `A fresh calendar key, wrapped to ${count} member${count === 1 ? '' : 's'}. Every membership change turns the key over.` },
			{ tone: 'warn', text: 'The server learns who is a member and their role, never a title.' }
		];
	});

	function toggle(accountId: string) {
		if (accountId === auth.accountId && request.mode === 'create') return;
		roles = { ...roles, [accountId]: roles[accountId] ? null : 'editor' };
	}

	function setRole(accountId: string, role: CalendarRole) {
		roles = { ...roles, [accountId]: role };
	}

	function meta(): CalendarMeta {
		return { schemaVersion: META_SCHEMA_VERSION, name: name.trim(), color, description: description.trim() || undefined, defaultPrivacy };
	}

	async function resolveRecipients(): Promise<{ accountId: string; publicKeyArmored: string; role: CalendarRole }[]> {
		const out = [];
		for (const m of members) {
			const role = roles[m.accountId];
			if (!role) continue;
			progress = `Verifying ${m.email}`;
			const lookup = await lookupAccount(m.email);
			await verifyDirectoryLookup(lookup, m.email.trim().toLowerCase());
			out.push({ accountId: m.accountId, publicKeyArmored: lookup.publicKeyArmored, role });
		}
		if (!out.length) throw new Error('Pick at least one member');
		if (!out.some((r) => r.role === 'owner')) throw new Error('A shared calendar needs an owner');
		return out;
	}

	async function mintKey(accountId: string) {
		const recipients = await resolveRecipients();
		progress = 'Creating the calendar key';
		const created = await keystore.createAliasKey({
			accountId,
			email: '',
			displayName: 'Thelemail calendar',
			recipients: recipients.map((r) => ({ accountId: r.accountId, publicKeyArmored: r.publicKeyArmored }))
		});
		if (!created.ok) {
			throw new Error(created.code === 'locked' ? 'Unlock your mailbox and try again' : 'Could not create the key');
		}
		const grants: CalendarMemberGrant[] = created.grants.map((g) => ({
			accountId: g.accountId,
			role: recipients.find((r) => r.accountId === g.accountId)?.role ?? 'editor',
			memberKeyFingerprint: hexToB64(g.memberKeyFingerprintHex),
			wrappedPrivateKey: textToB64(g.wrappedPrivateKeyArmored)
		}));
		const key: SealKey = {
			publicKeyArmored: created.publicKeyArmored,
			fingerprintB64: hexToB64(created.keyFingerprintHex),
			fingerprintHex: created.keyFingerprintHex
		};
		return { grants, key };
	}

	async function ownKey(accountId: string): Promise<SealKey> {
		const own = await senderKey(accountId);
		return { publicKeyArmored: own.publicKeyArmored, fingerprintB64: own.fingerprintB64, fingerprintHex: '' };
	}

	async function aliasKey(accountId: string, aliasId: string): Promise<SealKey> {
		const res = await keystore.getPublicKey({ accountId, aliasId });
		if (!res.ok) throw new Error('The shared address key is not loaded yet');
		return { publicKeyArmored: res.publicKeyArmored, fingerprintB64: bytesToB64(res.fingerprint), fingerprintHex: '' };
	}

	async function submitCreate(accountId: string) {
		if (!name.trim()) throw new Error('Give the calendar a name');
		let key: SealKey;
		let grants: CalendarMemberGrant[] | undefined;
		let sharedAliasId: string | undefined;
		if (kind === 'shared') {
			const minted = await mintKey(accountId);
			key = minted.key;
			grants = minted.grants;
		} else if (kind === 'role') {
			const addr = sharedAddresses.find((a) => a.id === aliasAddressId);
			if (!addr?.sharedAliasId) throw new Error('Pick a shared address');
			sharedAliasId = addr.sharedAliasId;
			key = await aliasKey(accountId, addr.sharedAliasId);
		} else {
			key = await ownKey(accountId);
		}
		progress = 'Sealing';
		const sealedMeta = await sealText(accountId, key, serializeMeta(meta()));
		progress = 'Saving';
		const row = await createCalendar({
			kind,
			sealedMeta,
			metaKeyFingerprint: key.fingerprintB64,
			metaSchemaVersion: META_SCHEMA_VERSION,
			calendarPublicKeyArmored: kind === 'shared' ? key.publicKeyArmored : undefined,
			keyAlgorithm: kind === 'shared' ? KEY_ALGORITHM : undefined,
			sharedAliasId,
			members: grants
		});
		if (kind === 'shared') await calendarKeys.load(accountId);
		await calendarStore.adoptCalendar(row);
		cal.notify(`Created “${row.id ? name.trim() : name}”`);
	}

	async function submitEdit() {
		if (!existing) return;
		if (!name.trim()) throw new Error('Give the calendar a name');
		await calendarStore.updateCalendarMeta(existing.id, meta());
		cal.notify('Calendar updated');
	}

	async function submitShare(accountId: string) {
		if (!existing) return;
		const minted = await mintKey(accountId);
		progress = 'Turning the key over';
		const row = await rotateCalendarMembers(existing.id, {
			calendarPublicKeyArmored: minted.key.publicKeyArmored,
			keyAlgorithm: KEY_ALGORITHM,
			members: minted.grants
		});
		await calendarKeys.load(accountId);
		const sealedMeta = await sealText(accountId, minted.key, serializeMeta(existing.meta ?? meta()));
		const patched = await updateCalendar(existing.id, {
			sealedMeta,
			metaKeyFingerprint: minted.key.fingerprintB64,
			metaSchemaVersion: META_SCHEMA_VERSION,
			baseRev: row.rev
		});
		await calendarStore.adoptCalendar(patched);
		progress = 'Re-sealing existing items for the new members';
		await calendarStore.resealCalendar(existing.id);
		cal.notify('Members updated · items re-sealed to the new key');
	}

	async function submitDelete() {
		if (!existing) return;
		await calendarStore.removeCalendar(existing.id);
		cal.notify(`Deleted “${existing.name}”`);
	}

	async function submit() {
		const accountId = auth.accountId;
		if (!accountId) return;
		busy = true;
		error = null;
		try {
			if (request.mode === 'create') await submitCreate(accountId);
			else if (request.mode === 'edit') await submitEdit();
			else if (request.mode === 'share') await submitShare(accountId);
			else await submitDelete();
			cal.dialog = null;
			cal.calendarDialog = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			busy = false;
			progress = '';
		}
	}
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		{#if request.mode === 'delete'}
			<Trash2 size={18} color="var(--danger-500)" />
		{:else if request.mode === 'share'}
			<KeyRound size={18} color="var(--brass-600)" />
		{:else}
			<CalendarPlus size={18} color="var(--brass-600)" />
		{/if}
		<Dialog.Title class="dt">{title}</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body cal-form">
		{#if request.mode === 'delete'}
			<p class="cal-dlg-lead">
				Delete “{existing?.name}” and everything in it? Members lose access; the server keeps tombstones for a month so devices can catch up, then removes the rows.
			</p>
		{:else}
			{#if request.mode === 'create' || request.mode === 'edit'}
				<label class="cal-field">
					<span>Name</span>
					<input type="text" bind:value={name} maxlength="120" placeholder="Family, Studio, Domains…" />
				</label>
				<div class="cal-field">
					<span>Colour</span>
					<div class="swatches">
						{#each PALETTE as c (c)}
							<button
								type="button"
								class="swatch"
								class:on={color === c}
								style:--c={c}
								aria-label="Use colour {c}"
								onclick={() => (color = c)}
							></button>
						{/each}
					</div>
				</div>
				<label class="cal-field">
					<span>Description</span>
					<input type="text" bind:value={description} maxlength="240" placeholder="Optional" />
				</label>
				<div class="cal-field">
					<span>New items default to</span>
					<div class="seg">
						{#each [['private', 'Private'], ['busy', 'Busy-only'], ['shared', 'Shared']] as [value, label] (value)}
							<button
								type="button"
								class:on={defaultPrivacy === value}
								onclick={() => (defaultPrivacy = value as Privacy)}
							>
								{label}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if request.mode === 'create'}
				<div class="cal-field">
					<span>Who can see it</span>
					<div class="seg">
						<button type="button" class:on={kind === 'personal'} onclick={() => (kind = 'personal')}>Just me</button>
						<button type="button" class:on={kind === 'shared'} disabled={!canShare} onclick={() => (kind = 'shared')}>Chosen members</button>
						<button type="button" class:on={kind === 'role'} disabled={!isAdmin || !sharedAddresses.length} onclick={() => (kind = 'role')}>A shared address</button>
					</div>
				</div>
			{/if}

			{#if request.mode === 'create' && kind === 'role'}
				<label class="cal-field">
					<span>Shared address</span>
					<select bind:value={aliasAddressId}>
						<option value="">Choose an address</option>
						{#each sharedAddresses as addr (addr.id)}
							<option value={addr.id}>{addr.email}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if (request.mode === 'create' && kind === 'shared') || request.mode === 'share'}
				<div class="cal-field">
					<span><Users size={14} /> Members</span>
					<div class="member-list">
						{#each members as m (m.accountId)}
							{@const role = roles[m.accountId] ?? null}
							<div class="member-row" class:on={!!role}>
								<Checkbox
									id="cal-member-{m.accountId}"
									checked={!!role}
									disabled={m.accountId === auth.accountId && request.mode === 'create'}
									onCheckedChange={() => toggle(m.accountId)}
								/>
								<label for="cal-member-{m.accountId}" class="member-name">
									{m.fullName || m.email}
									<span class="member-mail">{m.email}</span>
								</label>
								{#if role}
									<select value={role} onchange={(e) => setRole(m.accountId, (e.currentTarget as HTMLSelectElement).value as CalendarRole)}>
										<option value="owner">Owner</option>
										<option value="editor">Editor</option>
										<option value="viewer">Viewer</option>
									</select>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<DisclosureBoundary heading="What the server learns" lines={boundary} />
		{/if}

		{#if progress}<div class="cal-progress">{progress}…</div>{/if}
		{#if error}<div class="cal-error" role="alert">{error}</div>{/if}
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<div class="grow"></div>
		<Button variant="ghost" disabled={busy} onclick={() => (cal.dialog = null)}>Cancel</Button>
		<Button variant={request.mode === 'delete' ? 'dangerSolid' : 'primary'} disabled={busy} onclick={submit}>
			{request.mode === 'delete' ? 'Delete' : request.mode === 'share' ? 'Save members' : request.mode === 'edit' ? 'Save' : 'Create'}
		</Button>
	</Dialog.Footer>
</Dialog.Content>
