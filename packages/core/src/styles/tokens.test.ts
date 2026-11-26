// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderBody } from '$core/mail/render/renderBody';

type Theme = 'light' | 'dark';

const tokensCss = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

function block(selector: string): Map<string, string> {
	const start = tokensCss.indexOf(`${selector} {`);
	const body = tokensCss.slice(start, tokensCss.indexOf('}', start));
	const out = new Map<string, string>();
	for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
	return out;
}

const light = block(':root');
const dark = new Map([...light, ...block("[data-theme='dark']")]);

function token(theme: Theme, name: string): string {
	let value = (theme === 'light' ? light : dark).get(`--${name}`);
	for (let i = 0; value?.startsWith('var('); i++) {
		if (i > 8) throw new Error(`--${name} does not resolve`);
		value = (theme === 'light' ? light : dark).get(value.slice(4, -1));
	}
	if (!value) throw new Error(`--${name} is missing in ${theme}`);
	return value.toUpperCase();
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const MOBILE: Record<string, [string, string]> = {
	bg: ['#FBFAF8', '#131619'],
	'bg-raised': ['#F5F4F1', '#222528'],
	'bg-sunken': ['#EFEEEC', '#0D0F12'],
	surface: ['#FFFFFF', '#1A1C1F'],
	'surface-muted': ['#F5F4F1', '#222528'],
	fg: ['#21201F', '#E0E3E7'],
	'fg-strong': ['#131312', '#EFF1F4'],
	'fg-muted': ['#62605D', '#B8BDC2'],
	'fg-faint': ['#7A7976', '#9A9FA5'],
	'border-soft': ['#D4D3D1', '#393C3F'],
	'border-strong': ['#C5C4C1', '#505356'],
	'border-control': ['#878683', '#7D8085'],
	primary: ['#005C3B', '#8DCFAB'],
	'primary-hover': ['#176E4A', '#99DCB8'],
	'primary-press': ['#084C31', '#7ABC98'],
	'primary-fg': ['#F6FCF8', '#000E06'],
	link: ['#0E6240', '#93CDAD'],
	'brass-600': ['#765407', '#CC9E4B'],
	selection: ['#B0DEC48C', '#28523C8C'],
	'pine-100': ['#D6F1E2', '#1E3328'],
	'pine-500': ['#358660', '#4F9F77'],
	'pine-600': ['#1A6B48', '#6EB992'],
	'pine-700': ['#095436', '#90D2AE'],
	'brass-100': ['#F9E7CB', '#392B14'],
	'brass-500': ['#976C0B', '#B28324'],
	'brass-700': ['#5D4104', '#E4BA72'],
	'success-100': ['#DDF0D8', '#233320'],
	'success-500': ['#4E8242', '#73A967'],
	'success-700': ['#28521E', '#A1D097'],
	'warning-100': ['#FCE6CC', '#3B2A15'],
	'warning-500': ['#9B6612', '#C68B39'],
	'warning-700': ['#623D00', '#EAB675'],
	'danger-100': ['#FEE2DE', '#432420'],
	'danger-500': ['#B74C44', '#E27368'],
	'danger-700': ['#7A2520', '#FEA69C'],
	'info-100': ['#D7EDFD', '#1F303C'],
	'info-500': ['#3C7AA2', '#62A0CA'],
	'info-700': ['#174B6B', '#94C8EE'],
	'fg-on-pine': ['#F0F7F3', '#F0F7F3'],
	'bg-inverse': ['#102118', '#34383E']
};

const themes: Theme[] = ['light', 'dark'];

describe('colour tokens', () => {
	it.each(Object.entries(MOBILE))('%s matches the mobile palette in both themes', (name, [l, d]) => {
		expect(token('light', name)).toBe(l);
		expect(token('dark', name)).toBe(d);
	});

	it.each(themes)('keeps text on fills readable in %s', (theme) => {
		const c = (fg: string, bg: string) => contrast(token(theme, fg), token(theme, bg));
		expect(c('primary-fg', 'primary')).toBeGreaterThanOrEqual(4.5);
		for (const tone of ['pine', 'brass', 'success', 'warning', 'danger', 'info']) {
			expect(c(`${tone}-700`, `${tone}-100`)).toBeGreaterThanOrEqual(4.5);
		}
		for (const fill of ['success-500', 'danger-500', 'brass-500', 'info-500', 'brass-600']) {
			expect(c('primary-fg', fill)).toBeGreaterThanOrEqual(3);
		}
		expect(c('fg-on-pine', 'bg-inverse')).toBeGreaterThanOrEqual(4.5);
		expect(c('brass-on-inverse', 'bg-inverse')).toBeGreaterThanOrEqual(4.5);
		for (const surface of ['bg', 'surface']) {
			expect(c('fg', surface)).toBeGreaterThanOrEqual(7);
			expect(c('fg-muted', surface)).toBeGreaterThanOrEqual(4.5);
			expect(c('link', surface)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('paints mail bodies with the token ink', async () => {
		const { srcDoc } = await renderBody({ text: 'hello' });
		const css = srcDoc.toUpperCase();
		for (const name of ['fg', 'link', 'border-soft', 'fg-muted']) {
			expect(css).toContain(token('light', name));
			expect(css).toContain(token('dark', name));
		}
	});
});
