import { featurePreviewFlags, loadFeaturePreview } from '$lib/client/feature-previews.js';

export const prerender = false;
export const load = loadFeaturePreview(featurePreviewFlags.pantry);
