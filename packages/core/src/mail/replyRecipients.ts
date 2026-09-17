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
