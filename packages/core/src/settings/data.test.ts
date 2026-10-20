import { describe, expect, it } from 'vitest';
import { SECTIONS, SECTION_GROUPS, sectionLabelFromPath, visibleGroups } from './data';
import { m } from '$paraglide/messages.js';

const ids = (groups: ReturnType<typeof visibleGroups>) => groups.map((g) => [g.id, g.sections.map((s) => s.id)]);

describe('settings nav data', () => {
	it('lists every section exactly once', () => {
		const all = SECTION_GROUPS.flatMap((g) => g.sections.map((s) => s.id));
		expect(new Set(all).size).toBe(all.length);
		expect(SECTIONS.map((s) => s.id)).toEqual(all);
		expect(all).toHaveLength(14);
	});

	it('groups account, mail and app settings in a fixed order', () => {
		expect(ids(visibleGroups({ notifications: {}, updates: {} }))).toEqual([
			['account', ['profile', 'addresses', 'domains', 'account', 'security']],
			['mail', ['sending', 'reading', 'collections', 'blocked', 'import']],
			['app', ['notify', 'region', 'appearance', 'about']]
		]);
	});

	it('drops notifications and about where the platform lacks them', () => {
		expect(ids(visibleGroups({}))[2]).toEqual(['app', ['region', 'appearance']]);
		expect(ids(visibleGroups({ notifications: {} }))[2]).toEqual(['app', ['notify', 'region', 'appearance']]);
		expect(ids(visibleGroups({ updates: {} }))[2]).toEqual(['app', ['region', 'appearance', 'about']]);
	});

	it('never keeps an empty group', () => {
		for (const platform of [{}, { notifications: {} }, { updates: {} }, { notifications: {}, updates: {} }]) {
			expect(visibleGroups(platform).every((g) => g.sections.length > 0)).toBe(true);
		}
	});

	it('names the region section the same way everywhere', () => {
		expect(sectionLabelFromPath('/u/0/settings/region')).toBe(m.settings_nav_region());
	});
});
