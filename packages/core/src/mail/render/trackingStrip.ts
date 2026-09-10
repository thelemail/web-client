const TRACKING_PARAMS = new Set<string>([
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_term',
	'utm_content',
	'utm_id',
	'utm_source_platform',
	'utm_creative_format',
	'utm_marketing_tactic',
	'fbclid',
	'gclid',
	'gbraid',
	'wbraid',
	'dclid',
	'msclkid',
	'twclid',
	'ttclid',
	'igshid',
	'wickedid',
	'yclid',
	'mc_cid',
	'mc_eid',
	'mkt_tok',
	'_hsenc',
	'_hsmi',
	'hsctatracking',
	'_branch_match_id',
	'vero_id',
	'vero_conv',
	'ref_src',
	'ref_url',
	'oly_anon_id',
	'oly_enc_id',
	'sc_campaign',
	'sc_channel',
	'sc_content',
	'sc_country',
	'sc_geo',
	'sc_medium',
	'sc_outcome',
	'sc_publisher',
	'piwik_campaign',
	'piwik_kwd',
	'pk_campaign',
	'pk_kwd'
]);

export function stripTrackingParams(rawHref: string): string {
	if (!/^https?:\/\//i.test(rawHref)) return rawHref;
	let url: URL;
	try {
		url = new URL(rawHref);
	} catch {
		return rawHref;
	}
	let changed = false;
	const toDelete: string[] = [];
	for (const key of url.searchParams.keys()) {
		if (TRACKING_PARAMS.has(key.toLowerCase())) {
			toDelete.push(key);
			changed = true;
		}
	}
	if (!changed) return rawHref;
	for (const k of toDelete) url.searchParams.delete(k);
	return url.toString();
}
