import type { Component } from 'svelte';

export type LegalPolicySlug = 'privacy' | 'terms' | 'cookies';

export type LegalDocumentMeta = {
	title: string;
	description: string;
	effectiveDate: string;
	summary: string;
};

export type LegalContentModule = {
	default: Component;
	meta: LegalDocumentMeta;
};

export type LegalPolicyVersion = LegalDocumentMeta & {
	policy: LegalPolicySlug;
	version: string;
	archived: boolean;
};

export type LegalPolicy = {
	slug: LegalPolicySlug;
	title: string;
	current: LegalPolicyVersion;
	versions: LegalPolicyVersion[];
};
