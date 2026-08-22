import { handleScheduledMaintenance } from './lib/server/maintenance/scheduled.js';
import {
	stagingProofTelemetry,
	withStagingProofTelemetry
} from './lib/server/observability/staging-proof.js';

// The adapter writes this module during `pnpm build`; Wrangler then bundles it through this entrypoint.
import svelteKitWorker from '../.svelte-kit/cloudflare/_worker.js';

export default {
	async fetch(request, env, ctx) {
		const telemetry = stagingProofTelemetry(request, env);
		if (!telemetry) return svelteKitWorker.fetch(request, env, ctx);
		const response = await svelteKitWorker.fetch(request, telemetry.environment, ctx);
		console.log(
			JSON.stringify({
				event: 'staging_proof_request',
				proofLabel: telemetry.label,
				d1Opened: telemetry.evidence.d1Opened
			})
		);
		return withStagingProofTelemetry(response, telemetry.evidence);
	},
	async scheduled(_controller, env) {
		await handleScheduledMaintenance(env);
	}
} satisfies ExportedHandler<Env>;
