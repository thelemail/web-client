import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { DNSRecordStatus, RequiredDNSRecord } from '$core/api/customDomains';
import RecordList from './RecordList.svelte';

const NOW = Date.parse('2026-09-22T12:00:00Z');

function record(status: DNSRecordStatus, required = true): RequiredDNSRecord {
	return {
		kind: required ? 'dkim' : 'wkd',
		phase: 'sending',
		type: 'CNAME',
		host: required ? 'tm1._domainkey.acme.test' : 'openpgpkey.acme.test',
		value: 'target.thelemail.com',
		required,
		status,
		verifiedAt: status === 'ok' ? new Date(NOW - 60_000).toISOString() : null
	};
}

function chip(r: RequiredDNSRecord, missing?: 'pending' | 'fail') {
	render(RecordList, { records: [r], now: NOW, missing });
	const el = document.querySelector('.dns-chip');
	return { kind: el?.className.replace('dns-chip d-', ''), label: el?.textContent?.trim() };
}

afterEach(cleanup);

describe('RecordList chips', () => {
	it.each([
		['found', record('ok'), undefined, 'ok', 'Found'],
		['waiting', record('missing'), 'pending', 'pending', 'Waiting'],
		['not found', record('missing'), 'fail', 'fail', 'Not found'],
		['wrong value', record('mismatch'), 'pending', 'fail', 'Wrong value'],
		['optional found', record('ok', false), undefined, 'ok', 'Found'],
		['optional missing', record('missing', false), 'fail', 'warn', 'Not found'],
		['optional wrong value', record('mismatch', false), 'pending', 'warn', 'Wrong value']
	] as const)('labels a %s record', (_, r, missing, kind, label) => {
		expect(chip(r, missing)).toEqual({ kind, label });
	});
});
