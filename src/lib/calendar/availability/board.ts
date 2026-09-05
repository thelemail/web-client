import type { BusyTrust } from '../verifybusy';

export interface BoardWindow {
	startMs: number;
	endMs: number;
	itemId: string;
	trust: BusyTrust;
}

export interface BoardOwner {
	key: string;
	kind: 'member' | 'role' | 'unattributed';
	accountId: string | null;
	name: string;
	email: string | null;
	isMe: boolean;
	windows: BoardWindow[];
}

export interface BoardDay {
	date: string;
	startMs: number;
	endMs: number;
	weekend: boolean;
	today: boolean;
}

export interface BoardSegment {
	dayIndex: number;
	left: number;
	width: number;
	startMs: number;
	endMs: number;
	clippedStart: boolean;
	clippedEnd: boolean;
	verified: boolean;
	itemIds: string[];
}

export interface BoardLane {
	key: string;
	kind: BoardOwner['kind'];
	accountId: string | null;
	name: string;
	email: string | null;
	isMe: boolean;
	published: boolean;
	segments: BoardSegment[];
	worst: BusyTrust | null;
}

export interface Board {
	days: BoardDay[];
	lanes: BoardLane[];
	counts: { total: number; verified: number; unverified: number };
}

const TRUST_ORDER: BusyTrust[] = [
	'signature_failed',
	'key_mismatch',
	'signer_unknown',
	'key_unresolved',
	'unsigned',
	'verified'
];

export function worstTrust(values: BusyTrust[]): BusyTrust | null {
	let worst: BusyTrust | null = null;
	for (const v of values) {
		if (worst === null || TRUST_ORDER.indexOf(v) < TRUST_ORDER.indexOf(worst)) worst = v;
	}
	return worst;
}

function splitAcrossDays(w: BoardWindow, days: BoardDay[]): BoardSegment[] {
	const out: BoardSegment[] = [];
	for (let i = 0; i < days.length; i++) {
		const day = days[i];
		const start = Math.max(w.startMs, day.startMs);
		const end = Math.min(w.endMs, day.endMs);
		if (end <= start) continue;
		const span = day.endMs - day.startMs;
		out.push({
			dayIndex: i,
			left: ((start - day.startMs) / span) * 100,
			width: ((end - start) / span) * 100,
			startMs: start,
			endMs: end,
			clippedStart: w.startMs < day.startMs,
			clippedEnd: w.endMs > day.endMs,
			verified: w.trust === 'verified',
			itemIds: [w.itemId]
		});
	}
	return out;
}

function mergeSegments(segments: BoardSegment[]): BoardSegment[] {
	const sorted = [...segments].sort(
		(a, b) => a.dayIndex - b.dayIndex || a.startMs - b.startMs || a.endMs - b.endMs
	);
	const out: BoardSegment[] = [];
	for (const seg of sorted) {
		const last = out[out.length - 1];
		if (
			last &&
			last.dayIndex === seg.dayIndex &&
			last.verified === seg.verified &&
			seg.startMs <= last.endMs
		) {
			if (seg.endMs > last.endMs) {
				last.width += ((seg.endMs - last.endMs) / (seg.endMs - seg.startMs)) * seg.width;
				last.endMs = seg.endMs;
				last.clippedEnd = seg.clippedEnd;
			}
			for (const id of seg.itemIds) {
				if (!last.itemIds.includes(id)) last.itemIds.push(id);
			}
			continue;
		}
		out.push({ ...seg, itemIds: [...seg.itemIds] });
	}
	return out;
}

export function buildBoard(input: { days: BoardDay[]; owners: BoardOwner[] }): Board {
	const lanes: BoardLane[] = [];
	let verified = 0;
	let unverified = 0;

	for (const owner of input.owners) {
		const raw = owner.windows.flatMap((w) => splitAcrossDays(w, input.days));
		const segments = mergeSegments(raw);
		for (const seg of segments) {
			if (seg.verified) verified += 1;
			else unverified += 1;
		}
		lanes.push({
			key: owner.key,
			kind: owner.kind,
			accountId: owner.accountId,
			name: owner.name,
			email: owner.email,
			isMe: owner.isMe,
			published: owner.windows.length > 0,
			segments,
			worst: worstTrust(owner.windows.map((w) => w.trust))
		});
	}

	return {
		days: input.days,
		lanes,
		counts: { total: verified + unverified, verified, unverified }
	};
}
