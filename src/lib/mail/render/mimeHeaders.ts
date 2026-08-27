export function splitMimeHeaders(mime: string): string {
	if (!mime || !/^[!-9;-~]+:/.test(mime)) return '';
	const sep = mime.match(/\r?\n\r?\n/);
	const block = sep ? mime.slice(0, sep.index) : mime;
	return block.replace(/[\r\n]+$/, '');
}
