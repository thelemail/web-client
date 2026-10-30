import type { MessagePreviewRecipient } from './preview';
import { isOwnRecipient } from './recipientAddress';

export interface ReplyParty {
	display: string;
	address: string;
}

export interface ReplyToParty extends ReplyParty {
	offsite?: boolean;
}

export interface ReplySeed {
	sender: ReplyParty;
	senderIsMe: boolean;
	recipients: MessagePreviewRecipient[];
	replyTo?: ReplyToParty[];
}

function norm(address: string): string {
	return address.trim().toLowerCase();
}

function party(r: MessagePreviewRecipient): ReplyParty {
	return { display: r.display, address: r.address };
}

function dedupe<P extends ReplyParty>(
	list: P[],
	exclude: ReadonlySet<string>,
	mine: ReadonlySet<string> = new Set()
): P[] {
	const seen = new Set(exclude);
	const out: P[] = [];
	for (const p of list) {
		const key = norm(p.address);
		if (!key || seen.has(key) || isOwnRecipient(key, mine)) continue;
		seen.add(key);
		out.push(p);
	}
	return out;
}

function ownSet(myEmails: Set<string>): Set<string> {
	const mine = new Set<string>();
	for (const e of myEmails) mine.add(norm(e));
	return mine;
}

function senderIsMine(seed: ReplySeed, mine: ReadonlySet<string>): boolean {
	const senderAddr = norm(seed.sender.address);
	return seed.senderIsMe || (!!senderAddr && mine.has(senderAddr));
}

export function effectiveReplyTo(seed: ReplySeed, myEmails: Set<string>): ReplyToParty[] {
	const mine = ownSet(myEmails);
	if (senderIsMine(seed, mine)) return [];
	const replyTo = dedupe(seed.replyTo ?? [], new Set(), mine);
	const senderAddr = norm(seed.sender.address);
	if (replyTo.length === 1 && norm(replyTo[0].address) === senderAddr) return [];
	return replyTo;
}

export function replyTargets(
	seed: ReplySeed,
	mode: 'reply' | 'all',
	myEmails: Set<string>
): { to: ReplyParty[]; cc: ReplyParty[] } {
	const mine = ownSet(myEmails);
	const senderAddr = norm(seed.sender.address);
	const senderIsMe = senderIsMine(seed, mine);
	const toKind = seed.recipients.filter((r) => r.kind === 'to').map(party);
	const ccKind = seed.recipients.filter((r) => r.kind === 'cc').map(party);
	const replyTo = senderIsMe ? [] : dedupe(seed.replyTo ?? [], new Set(), mine);
	const sender = senderAddr ? [{ display: seed.sender.display, address: seed.sender.address }] : [];

	let to: ReplyParty[] = [];
	let cc: ReplyParty[] = [];

	if (mode === 'reply') {
		if (senderIsMe) {
			to = dedupe(toKind, new Set());
		} else {
			to = replyTo.length ? replyTo : sender;
		}
	} else {
		const head = senderIsMe ? [] : dedupe([...replyTo, ...sender], new Set());
		const excluded = new Set(mine);
		if (senderAddr) excluded.add(senderAddr);
		for (const p of head) excluded.add(norm(p.address));
		to = [...head, ...dedupe(toKind, excluded, mine)];
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

export function dropReplyTo<T>(
	lists: { to: T[]; cc: T[] },
	mode: 'reply' | 'all',
	seed: ReplySeed,
	myEmails: Set<string>,
	added: readonly string[],
	addressOf: (item: T) => string,
	make: (party: ReplyParty) => T
): { to: T[]; cc: T[]; added: string[]; seed: ReplySeed } {
	const plain: ReplySeed = { ...seed, replyTo: [] };
	const targets = replyTargets(plain, mode, myEmails);
	const keep = new Set([...targets.to, ...targets.cc].map((p) => norm(p.address)));
	const drop = new Set((seed.replyTo ?? []).map((p) => norm(p.address)).filter((a) => !keep.has(a)));
	const strip = (list: T[]) => list.filter((item) => !drop.has(norm(addressOf(item))));
	const to = strip(lists.to);
	const cc = strip(lists.cc);
	const present = new Set([...to, ...cc].map((item) => norm(addressOf(item))));
	const front = targets.to.filter((p) => !present.has(norm(p.address))).map(make);
	const direct = new Set(replyTargets(plain, 'reply', myEmails).to.map((p) => norm(p.address)));
	return {
		to: [...front, ...to],
		cc,
		added: added.filter((a) => !direct.has(a) && !drop.has(a)),
		seed: plain
	};
}

export function replyToSummary(entry: {
	replyTo?: ReplyToParty[];
	fromAddr: string;
	folder?: string;
}): { list: string; offsite: boolean } | null {
	if (entry.folder === 'spam' || !entry.replyTo?.length) return null;
	const from = norm(entry.fromAddr);
	if (entry.replyTo.every((p) => norm(p.address) === from)) return null;
	return {
		list: entry.replyTo.map((p) => p.address).join(', '),
		offsite: entry.replyTo.some((p) => p.offsite === true)
	};
}
