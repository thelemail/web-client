import type {
	CalendarItemRequest,
	CalendarItemStateRequest,
	CalendarItemSummary,
	UpdateCalendarRequest
} from '$core/api/calendars';
import { ApiCallError } from '$core/api/types';
import type { OutboxRecord } from './db';

export type OutboxStatus = 'queued' | 'sending' | 'blocked';

export interface OutboxRecipient {
	display?: string;
	address: string;
}

export interface OutboxMail {
	to: OutboxRecipient[];
	subject: string;
	body: string;
	ics: string;
	method: 'REQUEST' | 'REPLY' | 'CANCEL';
	fromEmail?: string;
	fromName?: string;
	fromAliasId?: string;
	inReplyToMessageId?: string;
	inReplyToHeader?: string;
	references?: string[];
}

export type OutboxOp =
	| {
			kind: 'item.put';
			calendarId: string;
			itemId: string;
			body: CalendarItemRequest;
			label: string;
			fields?: string[];
	  }
	| { kind: 'item.delete'; calendarId: string; itemId: string; baseRev: number; label: string }
	| {
			kind: 'state.put';
			calendarId: string;
			itemId: string;
			body: CalendarItemStateRequest;
			label: string;
	  }
	| { kind: 'calendar.patch'; calendarId: string; body: UpdateCalendarRequest; label: string }
	| { kind: 'calendar.delete'; calendarId: string; label: string }
	| { kind: 'invite.send'; itemId: string; mail: OutboxMail; label: string };

export type ErrorClass =
	| 'conflict'
	| 'not_found'
	| 'forbidden'
	| 'upgrade_required'
	| 'paused'
	| 'rate_limited'
	| 'offline'
	| 'server'
	| 'rejected';

export interface ClassifiedError {
	cls: ErrorClass;
	retryAfterMs?: number;
	message: string;
}

export function classifyError(err: unknown): ClassifiedError {
	if (err instanceof ApiCallError) {
		const code = err.envelope?.error.code;
		const message = err.envelope?.error.message ?? err.message;
		if (code === 'stale_revision' || code === 'conflict' || err.status === 409) {
			return { cls: 'conflict', message };
		}
		if (err.status === 404) return { cls: 'not_found', message };
		if (code === 'read_only' || code === 'account_suspended') return { cls: 'paused', message };
		if (err.status === 403) return { cls: 'forbidden', message };
		if (code === 'upgrade_required' || err.status === 402) {
			return { cls: 'upgrade_required', message };
		}
		if (err.status === 429) {
			const secs = err.envelope?.error.retryAfterSeconds ?? 30;
			return { cls: 'rate_limited', retryAfterMs: secs * 1000, message };
		}
		if (err.status >= 500 || err.status === 0) return { cls: 'server', message };
		return { cls: 'rejected', message };
	}
	if (
		err instanceof TypeError ||
		(err instanceof Error && /network|fetch|load failed/i.test(err.message))
	) {
		return { cls: 'offline', message: err instanceof Error ? err.message : 'offline' };
	}
	return { cls: 'server', message: err instanceof Error ? err.message : String(err) };
}

export interface ReplayApi {
	putItem(
		calendarId: string,
		itemId: string,
		body: CalendarItemRequest
	): Promise<CalendarItemSummary>;
	deleteItem(calendarId: string, itemId: string, baseRev: number): Promise<void>;
	putState(calendarId: string, itemId: string, body: CalendarItemStateRequest): Promise<unknown>;
	patchCalendar(calendarId: string, body: UpdateCalendarRequest): Promise<unknown>;
	deleteCalendar(calendarId: string): Promise<void>;
	sendMail(mail: OutboxMail): Promise<void>;
}

export interface ReplayHooks {
	applied(record: OutboxRecord, result: unknown): Promise<void>;
	rebase(record: OutboxRecord): Promise<OutboxRecord | null>;
	dropped(record: OutboxRecord, cls: ErrorClass, message: string): Promise<void>;
}

export type ReplayResult =
	| { outcome: 'applied' }
	| { outcome: 'dropped' }
	| { outcome: 'blocked'; message: string }
	| { outcome: 'retry'; delayMs: number; offline: boolean }
	| { outcome: 'halt'; cls: 'upgrade_required' | 'paused'; message: string };

export const REBASABLE_FIELDS = new Set(['partstat', 'done', 'reminders', 'ack']);

function canRebase(op: OutboxOp): boolean {
	return (
		op.kind === 'item.put' && !!op.fields?.length && op.fields.every((f) => REBASABLE_FIELDS.has(f))
	);
}

async function execute(record: OutboxRecord, api: ReplayApi): Promise<unknown> {
	const op = record.op;
	switch (op.kind) {
		case 'item.put':
			return api.putItem(op.calendarId, op.itemId, op.body);
		case 'item.delete':
			return api.deleteItem(op.calendarId, op.itemId, op.baseRev);
		case 'state.put':
			return api.putState(op.calendarId, op.itemId, op.body);
		case 'calendar.patch':
			return api.patchCalendar(op.calendarId, op.body);
		case 'calendar.delete':
			return api.deleteCalendar(op.calendarId);
		case 'invite.send':
			return api.sendMail(op.mail);
	}
}

export function backoffMs(attempts: number): number {
	return Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
}

export async function replayOne(
	record: OutboxRecord,
	api: ReplayApi,
	hooks: ReplayHooks
): Promise<ReplayResult> {
	let current = record;
	for (let pass = 0; pass < 2; pass++) {
		try {
			const result = await execute(current, api);
			await hooks.applied(current, result);
			return { outcome: 'applied' };
		} catch (err) {
			const { cls, retryAfterMs, message } = classifyError(err);
			switch (cls) {
				case 'conflict': {
					if (pass === 0 && canRebase(current.op)) {
						const rebased = await hooks.rebase(current);
						if (rebased) {
							current = rebased;
							continue;
						}
					}
					return { outcome: 'blocked', message };
				}
				case 'not_found':
				case 'forbidden':
				case 'rejected':
					await hooks.dropped(current, cls, message);
					return { outcome: 'dropped' };
				case 'upgrade_required':
				case 'paused':
					return { outcome: 'halt', cls, message };
				case 'rate_limited':
					return { outcome: 'retry', delayMs: retryAfterMs ?? 30_000, offline: false };
				case 'offline':
					return { outcome: 'retry', delayMs: backoffMs(current.attempts), offline: true };
				case 'server':
					return { outcome: 'retry', delayMs: backoffMs(current.attempts), offline: false };
			}
		}
	}
	return { outcome: 'blocked', message: 'conflict' };
}
