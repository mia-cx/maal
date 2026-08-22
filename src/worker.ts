import { handleScheduledMaintenance } from './lib/server/maintenance/scheduled.js';

// The adapter writes this module during `pnpm build`; Wrangler then bundles it through this entrypoint.
import svelteKitWorker from '../.svelte-kit/cloudflare/_worker.js';

export default {
	fetch(request, env, ctx) {
		return svelteKitWorker.fetch(request, env, ctx);
	},
	async scheduled(_controller, env) {
		await handleScheduledMaintenance(env);
	}
} satisfies ExportedHandler<Env>;
