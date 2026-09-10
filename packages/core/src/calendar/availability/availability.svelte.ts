import { listCalendarBusy, type CalendarBusyEntry } from '$core/api/calendars';
import { directoryTrust } from '$core/mail/senderVerify';
import { auth } from '$core/stores/auth.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import { calendarStore } from '../store.svelte';
import { verifyBusyWindows, type BusyTrust } from '../verifybusy';
import { buildBoard, type Board, type BoardDay, type BoardOwner, type BoardWindow } from './board';

const CACHE_TTL_MS = 60_000;
const MAX_RANGE_DAYS = 100;

interface CacheEntry {
	at: number;
	entries: CalendarBusyEntry[];
	trust: Map<string, BusyTrust>;
}

function trustKey(itemId: string, rev: number): string {
	return `${itemId}:${rev}`;
}

class AvailabilityStore {
	loading = $state(false);
	error = $state<string | null>(null);
	loadedAt = $state<number | null>(null);
	entries = $state<CalendarBusyEntry[]>([]);
	trust = $state(new Map<string, BusyTrust>());

	#cache = new Map<string, CacheEntry>();
	#token = 0;

	async load(from: Date, to: Date, force = false): Promise<void> {
		const accountId = auth.accountId;
		if (!accountId) return;
		if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
			this.error = 'That range is longer than availability can cover.';
			return;
		}
		const key = `${accountId}|${from.toISOString()}|${to.toISOString()}`;
		const hit = this.#cache.get(key);
		if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
			this.entries = hit.entries;
			this.trust = hit.trust;
			this.loadedAt = hit.at;
			return;
		}

		const token = ++this.#token;
		this.loading = true;
		this.error = null;
		try {
			const res = await listCalendarBusy(from.toISOString(), to.toISOString());
			if (token !== this.#token || auth.accountId !== accountId) return;
			const trust = await this.#verify(accountId, res.calendars);
			if (token !== this.#token || auth.accountId !== accountId) return;
			const at = Date.now();
			this.#cache.set(key, { at, entries: res.calendars, trust });
			this.entries = res.calendars;
			this.trust = trust;
			this.loadedAt = at;
		} catch (err) {
			if (token !== this.#token) return;
			this.error = err instanceof Error ? err.message : 'Could not load availability.';
		} finally {
			if (token === this.#token) this.loading = false;
		}
	}

	async #verify(accountId: string, entries: CalendarBusyEntry[]): Promise<Map<string, BusyTrust>> {
		const out = new Map<string, BusyTrust>();
		const keys = new Map<string, { publicKeyArmored: string; fingerprintHex: string } | null>();
		for (const entry of entries) {
			for (const item of entry.items ?? []) {
				const cacheKey = trustKey(item.itemId, item.rev);
				if (out.has(cacheKey)) continue;
				if (!keys.has(item.signerAccountId)) {
					keys.set(item.signerAccountId, await this.#keyFor(accountId, item.signerAccountId));
				}
				const key = keys.get(item.signerAccountId) ?? null;
				if (!key) {
					const member = workspaces.members.find((m) => m.accountId === item.signerAccountId);
					out.set(cacheKey, member ? 'key_unresolved' : 'signer_unknown');
					continue;
				}
				const verdict = await verifyBusyWindows({
					statement: {
						calendarId: entry.calendarId,
						itemId: item.itemId,
						privacy: item.privacy,
						rev: item.rev,
						signerAccountId: item.signerAccountId,
						windows: item.windows
					},
					signature: item.signature,
					signerKeyFingerprint: item.signerKeyFingerprint,
					publicKeyArmored: key.publicKeyArmored,
					directoryKeyFingerprintHex: key.fingerprintHex
				});
				out.set(cacheKey, verdict.trust);
			}
		}
		return out;
	}

	async #keyFor(
		accountId: string,
		signerAccountId: string
	): Promise<{ publicKeyArmored: string; fingerprintHex: string } | null> {
		const member = workspaces.members.find((m) => m.accountId === signerAccountId);
		if (!member) return null;
		try {
			const trust = await directoryTrust(accountId, member.email);
			if (!trust?.ok || !trust.publicKeyArmored || !trust.statement) return null;
			return {
				publicKeyArmored: trust.publicKeyArmored,
				fingerprintHex: trust.statement.keyFingerprint
			};
		} catch {
			return null;
		}
	}

	board(days: BoardDay[]): Board {
		const me = auth.accountId;
		const owners = new Map<string, BoardOwner>();

		for (const member of workspaces.members) {
			owners.set(member.accountId, {
				key: member.accountId,
				kind: 'member',
				accountId: member.accountId,
				name: member.fullName || member.email,
				email: member.email,
				isMe: member.accountId === me,
				windows: []
			});
		}

		for (const entry of this.entries) {
			for (const item of entry.items ?? []) {
				const trust = this.trust.get(trustKey(item.itemId, item.rev)) ?? 'unsigned';
				const windows: BoardWindow[] = item.windows.map((w) => ({
					startMs: Date.parse(w.startsAt),
					endMs: Date.parse(w.endsAt),
					itemId: item.itemId,
					trust
				}));
				const key = entry.kind === 'role' ? `role:${entry.calendarId}` : entry.ownerAccountId;
				let owner = owners.get(key);
				if (!owner) {
					owner =
						entry.kind === 'role'
							? {
									key,
									kind: 'role',
									accountId: null,
									name: calendarStore.calendar(entry.calendarId)?.name ?? 'A role calendar',
									email: null,
									isMe: false,
									windows: []
								}
							: {
									key,
									kind: 'unattributed',
									accountId: entry.ownerAccountId,
									name: 'An account in this workspace',
									email: null,
									isMe: false,
									windows: []
								};
					owners.set(key, owner);
				}
				owner.windows.push(...windows);
			}
		}

		const lanes = [...owners.values()].sort((a, b) => {
			if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
			if (a.kind !== b.kind) return a.kind === 'member' ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		return buildBoard({ days, owners: lanes });
	}
}

export const availability = new AvailabilityStore();
