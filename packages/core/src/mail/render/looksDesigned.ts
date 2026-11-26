const BACKGROUND_DECL = /background(?:-color|-image)?\s*:\s*([^;}"']+)/gi;
const BGCOLOR_ATTR = /\bbgcolor\s*=\s*["']?([^"'\s>]+)/gi;
const BACKGROUND_ATTR = /<[^>]*\sbackground\s*=\s*["']?[^"'\s>]/i;
const PLAIN_BACKGROUND =
	/^\s*(?:transparent|none|inherit|initial|unset|white|#fff|#ffffff|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(?:,\s*[\d.]+\s*)?\)|rgba\([^)]*,\s*0(?:\.0+)?\s*\))\s*(?:!important)?\s*$/i;

function painted(value: string | undefined): boolean {
	return value !== undefined && value.trim().length > 0 && !PLAIN_BACKGROUND.test(value);
}

function anyPainted(pattern: RegExp, html: string): boolean {
	for (const match of html.matchAll(pattern)) {
		if (painted(match[1])) return true;
	}
	return false;
}

export function looksDesigned(html: string): boolean {
	return anyPainted(BGCOLOR_ATTR, html) || BACKGROUND_ATTR.test(html) || anyPainted(BACKGROUND_DECL, html);
}
