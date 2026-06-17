import type { LegalContentModule, LegalPolicy, LegalPolicySlug, LegalPolicyVersion } from './types';

const policyTitles: Record<LegalPolicySlug, string> = {
	privacy: 'Privacy Policy',
	terms: 'Terms of Use',
	cookies: 'Cookie Policy'
};

const policySlugs = ['privacy', 'terms', 'cookies'] as const satisfies LegalPolicySlug[];

const modules: Partial<Record<string, LegalContentModule>> = import.meta.glob<LegalContentModule>(
	'/src/legal-content/*/*.svx',
	{ eager: true }
);

const legalPathPattern = /\/src\/legal-content\/([^/]+)\/([^/]+)\.svx$/;

export const currentLegalDate = (): string => new Date().toISOString().slice(0, 10);

function isPolicySlug(value: string): value is LegalPolicySlug {
	return policySlugs.includes(value as LegalPolicySlug);
}

function versionFromModule(path: string, module: LegalContentModule): LegalPolicyVersion | null {
	const match = legalPathPattern.exec(path);
	if (!match) return null;

	const [, policy, version] = match;
	if (!policy || !version || !isPolicySlug(policy)) return null;

	return {
		policy,
		version,
		archived: false,
		...module.meta
	};
}

function byNewestEffectiveDate(a: LegalPolicyVersion, b: LegalPolicyVersion) {
	return b.effectiveDate.localeCompare(a.effectiveDate) || b.version.localeCompare(a.version);
}

const versions = Object.entries(modules)
	.map(([path, module]) => (module ? versionFromModule(path, module) : null))
	.filter((version): version is LegalPolicyVersion => Boolean(version))
	.sort(byNewestEffectiveDate);

export function buildPolicy(slug: LegalPolicySlug, today = currentLegalDate()): LegalPolicy {
	const policyVersions = versions.filter((version) => version.policy === slug);
	const current =
		policyVersions.find((version) => version.effectiveDate <= today) ?? policyVersions.at(0);

	if (!current) {
		throw new Error(`Missing legal content for ${slug}`);
	}

	return {
		slug,
		title: policyTitles[slug],
		current,
		versions: policyVersions.map((version) => ({
			...version,
			archived: version.version !== current.version
		}))
	};
}

export function getPolicies(today = currentLegalDate()): Record<LegalPolicySlug, LegalPolicy> {
	return {
		privacy: buildPolicy('privacy', today),
		terms: buildPolicy('terms', today),
		cookies: buildPolicy('cookies', today)
	};
}

export function getPolicyList(today = currentLegalDate()): LegalPolicy[] {
	return policySlugs.map((slug) => buildPolicy(slug, today));
}

export function getPolicy(policy: string, today = currentLegalDate()): LegalPolicy | null {
	return isPolicySlug(policy) ? buildPolicy(policy, today) : null;
}

export function getPolicyVersion(
	policy: string,
	version: string,
	today = currentLegalDate()
): LegalPolicyVersion | null {
	return getPolicy(policy, today)?.versions.find((entry) => entry.version === version) ?? null;
}

export function getPolicyComponent(policy: LegalPolicySlug, version: string) {
	return modules[`/src/legal-content/${policy}/${version}.svx`]?.default ?? null;
}
