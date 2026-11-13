import type { Pointer } from '@thelemail/sqlite-wasm';

declare module '@thelemail/sqlite-wasm' {
	interface FunctionOptions {
		arity?: number;
		deterministic?: boolean;
		innocuous?: boolean;
		directOnly?: boolean;
	}

	interface Database {
		createFunction(name: string, fn: (ctx: Pointer, ...args: SqlValue[]) => SqlValue | boolean | void, options?: FunctionOptions): this;
	}

	interface CApi {
		readonly SQLITE_INTERRUPT: number;
		sqlite3_progress_handler(pDb: Pointer, ops: number, handler: ((arg: Pointer) => number) | 0, arg: Pointer): void;
	}
}

export const SQLITE_INTERRUPT = 9;

export function resultCode(err: unknown): number | null {
	if (err && typeof err === 'object' && 'resultCode' in err && typeof err.resultCode === 'number') return err.resultCode;
	return null;
}
