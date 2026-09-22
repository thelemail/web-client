import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	lookups: [] as string[],
	verified: [] as string[],
	requests: [] as {
		recipients: { accountId: string; envelope: { encryptedPreview: string }; address?: string }[];
		sent: { encryptedPreview: string };
		from?: string;
		scheduledAt?: string;
	}[],
	accounts: {
		'vlad@thelemail.test': 'acct-vlad',
		'support@company.test': 'acct-support',
		'ada@thelemail.test': 'acct-ada'
	} as Record<string, string>
}));

vi.mock('openpgp', () => ({
	readKey: async ({ armoredKey }: { armoredKey: string }) => ({
		getFingerprint: () => armoredKey.replace(/[^0-9a-f]/g, '').padEnd(40, '0').slice(0, 40)
	})
}));
vi.mock('$core/directory/lookup', async () => {
	const { ApiCallError } = await import('$core/api/types');
	return {
		lookupDirectory: async (email: string) => {
			h.lookups.push(email);
			const accountId = h.accounts[email];
			if (!accountId) throw new ApiCallError(404, null, 'not found');
			return { accountId, email, fullName: '', publicKeyArmored: `key-${accountId}` };
		}
	};
});
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: async (lookup: { email: string }, requested: string) => {
		h.verified.push(requested);
		if (lookup.email !== requested) throw new Error('address_mismatch');
		return {};
	},
	DirectoryVerificationError: class extends Error {}
}));
vi.mock('$core/directory/read-delegation', () => ({ verifyReadDelegate: async () => ({}) }));
vi.mock('$core/directory/signing-key', () => ({ DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: '' }));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribe: () => () => {},
		getPublicKey: async () => ({ ok: true, publicKeyArmored: 'me', fingerprint: new Uint8Array(20) }),
		encrypt: async ({ plaintext }: { plaintext: Uint8Array }) => ({ ok: true, ciphertext: plaintext })
	}
}));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'acct-me', email: 'me@thelemail.test', fullName: 'Me' }
}));
vi.mock('./signaturePack', () => ({
	packBodyForSend: async (bodyHtml: string | undefined) => ({ bodyHtml, relatedParts: [] })
}));
vi.mock('$core/api/messages', () => ({
	sendInternal: async (req: (typeof h.requests)[number]) => {
		h.requests.push(req);
		return { messageId: 'm1', storedAt: '' };
	}
}));

import { sendInternalMessage } from './send';
import type { MessagePreview } from './preview';

function preview(b64: string): MessagePreview {
	const bin = atob(b64);
	return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

function party(address: string) {
	return { display: '', address };
}

beforeEach(() => {
	h.lookups.length = 0;
	h.verified.length = 0;
	h.requests.length = 0;
});

describe('internal send to plus-tagged recipients', () => {
	it('looks up and verifies only the base address', async () => {
		await sendInternalMessage({ to: [party('Vlad+Shop@thelemail.test')], subject: 's', body: 'b' });
		expect(h.lookups).toEqual(['vlad@thelemail.test']);
		expect(h.verified).toEqual(['vlad@thelemail.test']);
	});

	it('delivers base and tags to one envelope per account across To, Cc and Bcc', async () => {
		await sendInternalMessage({
			to: [party('vlad+a@thelemail.test'), party('ada@thelemail.test')],
			cc: [party('vlad@thelemail.test')],
			bcc: [party('vlad+b@thelemail.test'), party('support+billing@company.test')],
			subject: 's',
			body: 'b'
		});
		expect(h.lookups.sort()).toEqual(['ada@thelemail.test', 'support@company.test', 'vlad@thelemail.test']);
		const req = h.requests[0];
		expect(req.recipients.map((r) => r.accountId).sort()).toEqual(['acct-ada', 'acct-support', 'acct-vlad']);

		const byAccount = new Map(req.recipients.map((r) => [r.accountId, preview(r.envelope.encryptedPreview)]));
		expect(byAccount.get('acct-vlad')?.delivered_to).toBe('vlad+a@thelemail.test');
		expect(byAccount.get('acct-support')?.delivered_to).toBe('support+billing@company.test');
		expect(byAccount.get('acct-ada')?.delivered_to).toBeUndefined();

		for (const p of byAccount.values()) {
			expect(p.recipients.map((r) => r.address)).toEqual([
				'vlad+a@thelemail.test',
				'ada@thelemail.test',
				'vlad@thelemail.test'
			]);
			expect(p.recipients.some((r) => r.kind === 'bcc')).toBe(false);
		}
		expect(preview(req.sent.encryptedPreview).delivered_to).toBeUndefined();
	});

	it('does not tell a bcc recipient about another recipient tag', async () => {
		await sendInternalMessage({
			to: [party('ada+news@thelemail.test')],
			bcc: [party('vlad+secret@thelemail.test')],
			subject: 's',
			body: 'b'
		});
		const byAccount = new Map(
			h.requests[0].recipients.map((r) => [r.accountId, JSON.stringify(preview(r.envelope.encryptedPreview))])
		);
		expect(byAccount.get('acct-ada')).not.toContain('secret');
		expect(byAccount.get('acct-vlad')).toContain('vlad+secret@thelemail.test');
	});

	it('refuses an unknown tagged recipient instead of treating it as another account', async () => {
		await expect(
			sendInternalMessage({ to: [party('nobody+x@thelemail.test')], subject: 's', body: 'b' })
		).rejects.toMatchObject({ code: 'recipient_unknown' });
		expect(h.lookups).toEqual(['nobody@thelemail.test']);
	});
});

describe('internal send addressing fields', () => {
	it('sends the chosen From and the looked-up address for each recipient account', async () => {
		await sendInternalMessage({
			to: [party('Vlad+Shop@thelemail.test'), party('ada@thelemail.test')],
			cc: [party('vlad@thelemail.test')],
			bcc: [party('support+billing@company.test')],
			fromEmail: 'desk@company.test',
			subject: 's',
			body: 'b'
		});
		const req = h.requests[0];
		expect(req.from).toBe('desk@company.test');
		expect(req.scheduledAt).toBeUndefined();
		expect(Object.fromEntries(req.recipients.map((r) => [r.accountId, r.address]))).toEqual({
			'acct-vlad': 'vlad@thelemail.test',
			'acct-ada': 'ada@thelemail.test',
			'acct-support': 'support@company.test'
		});
	});

	it('carries both fields on a scheduled send and falls back to the account address for From', async () => {
		const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
		await sendInternalMessage({
			to: [party('ada+news@thelemail.test')],
			scheduledAt,
			subject: 's',
			body: 'b'
		});
		const req = h.requests[0];
		expect(req.scheduledAt).toBe(scheduledAt);
		expect(req.from).toBe('me@thelemail.test');
		expect(req.recipients).toHaveLength(1);
		expect(req.recipients[0]).toMatchObject({ accountId: 'acct-ada', address: 'ada@thelemail.test' });
	});
});
