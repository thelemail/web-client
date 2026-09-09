// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconvLite = { decode: (b: any, enc: string) => string; encodingExists: (e: string) => boolean };

let iconvRef: IconvLite | null = null;
let iconvLoading: Promise<void> | null = null;

export function enableIconvFallback(): Promise<void> {
	if (iconvRef) return Promise.resolve();
	if (iconvLoading) return iconvLoading;
	iconvLoading = import('iconv-lite').then((mod) => {
		iconvRef = mod as unknown as IconvLite;
	});
	return iconvLoading;
}

declare global {
	// eslint-disable-next-line no-var
	var __thelemailTextDecoderPatched: boolean | undefined;
}

if (typeof globalThis !== 'undefined' && !globalThis.__thelemailTextDecoderPatched) {
	const Original = globalThis.TextDecoder;
	if (Original) {
		class WidenedTextDecoder {
			encoding: string;
			fatal: boolean;
			ignoreBOM: boolean;
			private inner: TextDecoder | null;
			private icon: string | null;

			constructor(label?: string, opts?: TextDecoderOptions) {
				const enc = (label || 'utf-8').toLowerCase();
				this.encoding = enc;
				this.fatal = opts?.fatal ?? false;
				this.ignoreBOM = opts?.ignoreBOM ?? false;
				try {
					this.inner = new Original(label, opts);
					this.icon = null;
					return;
				} catch (err) {
					if (iconvRef && iconvRef.encodingExists(enc)) {
						this.inner = null;
						this.icon = enc;
						return;
					}
					this.inner = new Original('windows-1252', { fatal: false });
					this.icon = null;
					return;
				}
			}

			decode(input?: BufferSource, options?: TextDecodeOptions): string {
				if (this.inner) return this.inner.decode(input, options);
				if (!input) return '';
				const bytes =
					input instanceof Uint8Array
						? input
						: input instanceof ArrayBuffer
							? new Uint8Array(input)
							: new Uint8Array((input as ArrayBufferView).buffer);
				if (iconvRef) {
					try {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						return iconvRef.decode(bytes as any, this.icon!);
					} catch {
					}
				}
				return new Original('windows-1252', { fatal: false }).decode(bytes);
			}
		}

		Object.defineProperty(WidenedTextDecoder, 'name', { value: 'TextDecoder' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).TextDecoder = WidenedTextDecoder;
		globalThis.__thelemailTextDecoderPatched = true;
	}
}

const NATIVE_CHARSETS = new Set([
	'utf-8',
	'utf8',
	'us-ascii',
	'ascii',
	'iso-8859-1',
	'iso-8859-2',
	'iso-8859-3',
	'iso-8859-4',
	'iso-8859-5',
	'iso-8859-6',
	'iso-8859-7',
	'iso-8859-8',
	'iso-8859-8-i',
	'iso-8859-10',
	'iso-8859-13',
	'iso-8859-14',
	'iso-8859-15',
	'iso-8859-16',
	'windows-1250',
	'windows-1251',
	'windows-1252',
	'windows-1253',
	'windows-1254',
	'windows-1255',
	'windows-1256',
	'windows-1257',
	'windows-1258',
	'koi8-r',
	'koi8-u',
	'ibm866',
	'macintosh',
	'x-mac-cyrillic',
	'gbk',
	'gb18030',
	'big5',
	'euc-jp',
	'euc-kr',
	'iso-2022-jp',
	'shift_jis',
	'shift-jis',
	'sjis',
	'utf-16',
	'utf-16le',
	'utf-16be'
]);

export function mayNeedIconv(charsetLabel: string): boolean {
	const c = charsetLabel.toLowerCase().trim();
	if (!c) return false;
	return !NATIVE_CHARSETS.has(c);
}
