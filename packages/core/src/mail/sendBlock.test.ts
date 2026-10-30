import { describe, expect, it } from 'vitest';
import type { Attachment } from './attachmentUpload';
import { attachmentStatusText, dockAttention, sendBlock, sendBlockText } from './sendBlock';

function att(name: string, status: Attachment['status']): Pick<Attachment, 'id' | 'file' | 'status'> {
	return { id: name, file: new File([new Uint8Array(1)], name), status };
}

const clear = { noSender: false, revokedFrom: null, attachments: [] };

describe('sendBlock', () => {
	it('lets a draft with ready attachments go', () => {
		expect(sendBlock({ ...clear, attachments: [att('plan.pdf', 'ready')] })).toBeNull();
	});

	it('stops on a revoked From before anything else', () => {
		const b = sendBlock({ ...clear, revokedFrom: 'old@a.test', attachments: [att('budget.xlsx', 'error')] });
		expect(b).toEqual({ kind: 'from', address: 'old@a.test' });
		expect(sendBlockText(b!)).toBe('Choose a From address before sending.');
	});

	it('names the failed file ahead of one still uploading', () => {
		const b = sendBlock({
			...clear,
			attachments: [att('photo.heic', 'uploading'), att('budget.xlsx', 'error')]
		});
		expect(b).toEqual({ kind: 'attachment-failed', id: 'budget.xlsx', name: 'budget.xlsx' });
		expect(sendBlockText(b!)).toBe('Try budget.xlsx again or remove it before sending.');
	});

	it('treats an upload cut off by closing the composer as failed', () => {
		expect(sendBlock({ ...clear, attachments: [att('scan.pdf', 'cancelled')] })?.kind).toBe('attachment-failed');
	});

	it('waits for every queued, encrypting or uploading file', () => {
		for (const status of ['queued', 'encrypting', 'uploading'] as const) {
			const b = sendBlock({ ...clear, attachments: [att('ready.pdf', 'ready'), att('big.zip', status)] });
			expect(b).toEqual({ kind: 'attachment-pending', id: 'big.zip', name: 'big.zip' });
		}
		expect(sendBlockText({ kind: 'attachment-pending', id: 'x', name: 'big.zip' })).toBe(
			'Wait for big.zip to finish uploading.'
		);
	});

	it('has nothing to send from when no address can send', () => {
		expect(sendBlock({ ...clear, noSender: true, revokedFrom: 'old@a.test' })).toEqual({ kind: 'no-sender' });
	});
});

describe('draft status for attachments', () => {
	it('reports a failed file instead of letting the text status stand alone', () => {
		expect(attachmentStatusText([att('a.pdf', 'uploading'), att('budget.xlsx', 'error')])).toBe(
			'budget.xlsx failed to upload'
		);
	});

	it('counts uploads still running', () => {
		expect(attachmentStatusText([att('a.pdf', 'uploading'), att('b.pdf', 'queued')])).toBe('2 uploads in progress');
		expect(attachmentStatusText([att('a.pdf', 'encrypting')])).toBe('1 upload in progress');
	});

	it('adds nothing once every file is ready', () => {
		expect(attachmentStatusText([att('a.pdf', 'ready')])).toBeNull();
		expect(attachmentStatusText([])).toBeNull();
	});
});

describe('dockAttention', () => {
	it('flags a minimised draft that cannot send without the user', () => {
		expect(dockAttention({ kind: 'from', address: 'old@a.test' })).toBe('Choose From');
		expect(dockAttention({ kind: 'attachment-failed', id: 'x', name: 'x' })).toBe('File failed');
	});

	it('stays quiet for uploads that will finish by themselves', () => {
		expect(dockAttention({ kind: 'attachment-pending', id: 'x', name: 'x' })).toBeNull();
		expect(dockAttention(null)).toBeNull();
	});
});
