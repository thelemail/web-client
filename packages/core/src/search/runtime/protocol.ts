import type { ParsedQuery } from '../query/ast';
import type { Grouping, QueryContext, Sort } from '../sqlite/compile';
import type { Completions, PageResult, Provisional, QueryOutcome } from '../sqlite/run';
import type { Conditions, JobClass } from './scheduler';
import type { SyncProgress } from '../sync/jobs';
import type { CoverageCount, QueueCounts } from '../sync/store';

export type Persistence = 'persistent' | 'session';
export type Limit = 'session' | 'quota';

export type Mode = 'saved' | 'preview';

export interface SearchStatus {
	persistence: Persistence;
	mode: Mode;
	limited: Limit | null;
	sources: number;
	working: JobClass | null;
	paused: boolean;
	generation: number;
	sync: SyncStatus | null;
}

export interface SyncStatus extends SyncProgress {
	queue: QueueCounts;
	coverage: CoverageCount[];
}

export type InitResult = { ok: true; status: SearchStatus; rebuilt: boolean } | { ok: false; code: 'locked' | 'failed' };

export type ControlRequest =
	| { op: 'init'; accountId: string; generationId: string; installationSalt: Uint8Array; keystore: MessagePort; bridge?: MessagePort; paused: boolean }
	| { op: 'memory'; bridge?: MessagePort; mode: Mode; paused: boolean }
	| { op: 'connect'; port: MessagePort }
	| { op: 'activity'; conditions: Conditions }
	| { op: 'job'; name: string; message: unknown }
	| { op: 'close'; wipe: boolean };

export interface QueryRequestOptions {
	sort: Sort;
	group: Grouping;
}

export type ClientRequest =
	| { op: 'query'; token: number; query: ParsedQuery; ctx: QueryContext; options: QueryRequestOptions }
	| { op: 'cancel'; token: number }
	| { op: 'page'; session: number; index: number }
	| { op: 'closeQuery'; session: number }
	| { op: 'complete'; prefix: string }
	| { op: 'history' }
	| { op: 'remember'; query: string }
	| { op: 'forget' }
	| { op: 'pause'; paused: boolean }
	| { op: 'retryFailed' }
	| { op: 'status' }
	| { op: 'ping' }
	| { op: 'bye' };

export type QueryReply = QueryOutcome | { ok: false; cancelled: true };

export type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export interface StatusEvent {
	type: 'status';
	status: SearchStatus;
}

export interface ProgressEvent {
	type: 'progress';
	token: number;
	progress: Provisional;
}

export type ClientMessage = Reply | StatusEvent | ProgressEvent;

export interface ClientResults {
	query: QueryReply;
	page: PageResult;
	status: SearchStatus;
	complete: Completions;
	history: string[];
}

export function directoryFor(accountId: string): string {
	return `s-${accountId}`;
}

export function fileFor(generationId: string): string {
	return `/${generationId}.db`;
}
