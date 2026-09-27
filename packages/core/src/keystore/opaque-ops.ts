import type { PrivateKey } from 'openpgp';

export const OPAQUE_OP_TTL_MS = 10 * 60 * 1000;

export interface OpaqueOperation {
	kind:
		| 'register'
		| 'login'
		| 'migrationStage'
		| 'recoverySetup'
		| 'recoveryLogin'
		| 'passwordChange'
		| 'amkRotation';
	at: number;
	clientState?: string;
	password?: string;
	email?: string;
	accountId?: string;
	recovery?: boolean;
	privateKeyObj?: PrivateKey;
	publicKeyArmored?: string;
	armoredEncryptedPrivateKey?: string;
	amk?: Uint8Array;
	exportKey?: Uint8Array;
	wrappedMasterKeyB64?: string;
	masterKeyIdB64?: string;
}

export function wipeOpaqueOperation(op: OpaqueOperation): void {
	op.amk?.fill(0);
	op.exportKey?.fill(0);
	op.amk = undefined;
	op.exportKey = undefined;
	op.password = undefined;
	op.clientState = undefined;
	op.privateKeyObj = undefined;
	op.armoredEncryptedPrivateKey = undefined;
}

export function settleLogin(
	op: OpaqueOperation,
	accountId: string,
	exportKey: Uint8Array,
	now = Date.now()
): void {
	op.password = undefined;
	op.clientState = undefined;
	op.accountId = accountId;
	op.exportKey = exportKey;
	op.at = now;
}

export class OpaqueOperations {
	private readonly ops = new Map<string, OpaqueOperation>();

	get size(): number {
		return this.ops.size;
	}

	get(id: string): OpaqueOperation | undefined {
		return this.ops.get(id);
	}

	set(id: string, op: OpaqueOperation): void {
		this.ops.set(id, op);
	}

	delete(id: string): boolean {
		return this.ops.delete(id);
	}

	take(id: string): OpaqueOperation | undefined {
		const op = this.ops.get(id);
		this.ops.delete(id);
		return op;
	}

	abandon(id: string): void {
		const op = this.take(id);
		if (op) wipeOpaqueOperation(op);
	}

	reap(now = Date.now()): void {
		const cutoff = now - OPAQUE_OP_TTL_MS;
		for (const [id, op] of this.ops) {
			if (op.at < cutoff) {
				wipeOpaqueOperation(op);
				this.ops.delete(id);
			}
		}
	}

	clear(): void {
		for (const op of this.ops.values()) wipeOpaqueOperation(op);
		this.ops.clear();
	}
}
