import { describe, expect, it } from 'vitest';
import { buildBoard, worstTrust, type BoardDay, type BoardOwner } from './board';

const DAY = 86_400_000;
const MON = Date.UTC(2026, 8, 7);

function days(count = 3): BoardDay[] {
	return Array.from({ length: count }, (_, i) => ({
		date: `2026-09-0${7 + i}`,
		startMs: MON + i * DAY,
		endMs: MON + (i + 1) * DAY,
		weekend: false,
		today: false
	}));
}

function owner(windows: BoardOwner['windows']): BoardOwner {
	return {
		key: 'a',
		kind: 'member',
		accountId: 'a',
		name: 'A',
		email: 'a@thelemail.test',
		isMe: false,
		windows
	};
}

describe('availability board', () => {
	it('places a window inside one day at the right offset and width', () => {
		const board = buildBoard({
			days: days(),
			owners: [
				owner([
					{ startMs: MON + 6 * 3_600_000, endMs: MON + 12 * 3_600_000, itemId: 'i', trust: 'verified' }
				])
			]
		});
		const [seg] = board.lanes[0].segments;
		expect(seg.dayIndex).toBe(0);
		expect(seg.left).toBeCloseTo(25);
		expect(seg.width).toBeCloseTo(25);
	});

	it('splits a window that crosses midnight into consecutive days', () => {
		const board = buildBoard({
			days: days(),
			owners: [
				owner([
					{
						startMs: MON + 22 * 3_600_000,
						endMs: MON + 26 * 3_600_000,
						itemId: 'i',
						trust: 'verified'
					}
				])
			]
		});
		expect(board.lanes[0].segments.map((s) => s.dayIndex)).toEqual([0, 1]);
	});

	it('clips a window that starts before the range', () => {
		const board = buildBoard({
			days: days(),
			owners: [owner([{ startMs: MON - DAY, endMs: MON + 3_600_000, itemId: 'i', trust: 'verified' }])]
		});
		const [seg] = board.lanes[0].segments;
		expect(seg.left).toBe(0);
		expect(seg.clippedStart).toBe(true);
	});

	it('uses the real length of a long DST day rather than assuming 24 hours', () => {
		const longDay: BoardDay[] = [
			{ date: '2026-10-25', startMs: 0, endMs: 25 * 3_600_000, weekend: false, today: false }
		];
		const board = buildBoard({
			days: longDay,
			owners: [owner([{ startMs: 0, endMs: 3_600_000, itemId: 'i', trust: 'verified' }])]
		});
		expect(board.lanes[0].segments[0].width).toBeCloseTo(4);
	});

	it('merges overlapping windows that share a trust level', () => {
		const board = buildBoard({
			days: days(),
			owners: [
				owner([
					{ startMs: MON, endMs: MON + 2 * 3_600_000, itemId: 'one', trust: 'verified' },
					{ startMs: MON + 3_600_000, endMs: MON + 3 * 3_600_000, itemId: 'two', trust: 'verified' }
				])
			]
		});
		expect(board.lanes[0].segments).toHaveLength(1);
		expect(board.lanes[0].segments[0].itemIds.sort()).toEqual(['one', 'two']);
	});

	it('never merges an unverified window into a verified one', () => {
		const board = buildBoard({
			days: days(),
			owners: [
				owner([
					{ startMs: MON, endMs: MON + 2 * 3_600_000, itemId: 'good', trust: 'verified' },
					{
						startMs: MON + 3_600_000,
						endMs: MON + 3 * 3_600_000,
						itemId: 'bad',
						trust: 'signature_failed'
					}
				])
			]
		});
		const segs = board.lanes[0].segments;
		expect(segs).toHaveLength(2);
		expect(segs.filter((s) => s.verified)).toHaveLength(1);
		expect(board.counts).toEqual({ total: 2, verified: 1, unverified: 1 });
	});

	it('marks a member with no windows as not having published', () => {
		const board = buildBoard({ days: days(), owners: [owner([])] });
		expect(board.lanes[0].published).toBe(false);
		expect(board.lanes[0].worst).toBeNull();
	});

	it('ranks the worst trust so a lane reports its weakest window', () => {
		expect(worstTrust(['verified', 'unsigned', 'signature_failed'])).toBe('signature_failed');
		expect(worstTrust(['verified', 'key_unresolved'])).toBe('key_unresolved');
		expect(worstTrust(['verified'])).toBe('verified');
		expect(worstTrust([])).toBeNull();
	});
});
