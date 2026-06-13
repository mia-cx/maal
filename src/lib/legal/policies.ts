import type { LegalContentModule, LegalPolicy, LegalPolicySlug, LegalPolicyVersion } from './types';

const policyTitles: Record<LegalPolicySlug, string> = {
	privacy: 'Privacy Policy',
	terms: 'Terms of Use',
	cookies: 'Cookie Policy'
};

const modules: Partial<Record<string, LegalContentModule>> = import.meta.glob<LegalContentModule>(
	'/src/legal-content/*/*.svx',
	{ eager: true }
);

const today = new Date().toISOString().slice(0, 10);

const legalPathPattern = /\/src\/legal-content\/([^/]+)\/([^/]+)\.svx$/;

function isPolicySlug(value: string): value is LegalPolicySlug {
	return value === 'privacy' || value === 'terms' || value === 'cookies';
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

function buildPolicy(slug: LegalPolicySlug): LegalPolicy {
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

export const policies = {
	privacy: buildPolicy('privacy'),
	terms: buildPolicy('terms'),
	cookies: buildPolicy('cookies')
} satisfies Record<LegalPolicySlug, LegalPolicy>;

export const policyList = Object.values(policies);

export function getPolicy(policy: string): LegalPolicy | null {
	return isPolicySlug(policy) ? policies[policy] : null;
}

export function getPolicyVersion(policy: string, version: string): LegalPolicyVersion | null {
	return getPolicy(policy)?.versions.find((entry) => entry.version === version) ?? null;
}

export function getPolicyComponent(policy: LegalPolicySlug, version: string) {
	return modules[`/src/legal-content/${policy}/${version}.svx`]?.default ?? null;
}
