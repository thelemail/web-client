import type { MessagePreviewRecipient } from './preview';
import { isOwnRecipient } from './recipientAddress';

export interface ReplyParty {
	display: string;
	address: string;
}

export interface ReplySeed {
	sender: ReplyParty;
	senderIsMe: boolean;
	recipients: MessagePreviewRecipient[];
}

function norm(address: string): string {
	return address.trim().toLowerCase();
}

function party(r: MessagePreviewRecipient): ReplyParty {
	return { display: r.display, address: r.address };
}

function dedupe(list: ReplyParty[], exclude: ReadonlySet<string>, mine: ReadonlySet<string> = new Set()): ReplyParty[] {
	const seen = new Set(exclude);
	const out: ReplyParty[] = [];
	for (const p of list) {
		const key = norm(p.address);
		if (!key || seen.has(key) || isOwnRecipient(key, mine)) continue;
		seen.add(key);
		out.push(p);
	}
	return out;
}

export function replyTargets(
	seed: ReplySeed,
	mode: 'reply' | 'all',
	myEmails: Set<string>
): { to: ReplyParty[]; cc: ReplyParty[] } {
	const mine = new Set<string>();
	for (const e of myEmails) mine.add(norm(e));
	const senderAddr = norm(seed.sender.address);
	const senderIsMe = seed.senderIsMe || (!!senderAddr && mine.has(senderAddr));
	const toKind = seed.recipients.filter((r) => r.kind === 'to').map(party);
	const ccKind = seed.recipients.filter((r) => r.kind === 'cc').map(party);

	let to: ReplyParty[] = [];
	let cc: ReplyParty[] = [];

	if (mode === 'reply') {
		if (senderIsMe) {
			to = dedupe(toKind, new Set());
		} else if (senderAddr) {
			to = [{ display: seed.sender.display, address: seed.sender.address }];
		}
	} else {
		const excluded = new Set(mine);
		if (senderAddr) excluded.add(senderAddr);
		if (!senderIsMe && senderAddr) {
			to = [{ display: seed.sender.display, address: seed.sender.address }, ...dedupe(toKind, excluded, mine)];
		} else {
			to = dedupe(toKind, excluded, mine);
		}
		const inTo = new Set(mine);
		for (const p of to) inTo.add(norm(p.address));
		cc = dedupe(ccKind, inTo, mine);
	}

	if (to.length === 0 && cc.length === 0) {
		to = dedupe(toKind, new Set());
	}

	return { to, cc };
}

export interface ReplyLists<T> {
	to: T[];
	cc: T[];
	bcc: T[];
}

export function switchReplyMode<T>(
	lists: ReplyLists<T>,
	next: 'reply' | 'all',
	seed: ReplySeed,
	myEmails: Set<string>,
	added: readonly string[],
	addressOf: (item: T) => string,
	make: (party: ReplyParty) => T
): { to: T[]; cc: T[]; added: string[] } {
	if (next === 'reply') {
		const drop = new Set(added.map(norm));
		const keep = (item: T) => !drop.has(norm(addressOf(item)));
		return { to: lists.to.filter(keep), cc: lists.cc.filter(keep), added: [] };
	}
	const present = new Set([...lists.to, ...lists.cc, ...lists.bcc].map((i) => norm(addressOf(i))));
	const targets = replyTargets(seed, 'all', myEmails);
	const fresh: string[] = [];
	const take = (parties: ReplyParty[]) => {
		const out: T[] = [];
		for (const p of parties) {
			const key = norm(p.address);
			if (!key || present.has(key)) continue;
			present.add(key);
			fresh.push(key);
			out.push(make(p));
		}
		return out;
	};
	const to = [...lists.to, ...take(targets.to)];
	const cc = [...lists.cc, ...take(targets.cc)];
	return { to, cc, added: [...added.map(norm), ...fresh] };
}
