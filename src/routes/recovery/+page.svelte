<script lang="ts">
	import { onMount } from 'svelte';
	import type Dexie from 'dexie';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';

	import {
		clearBrowserDatabasePromises,
		getBrowserRecoveryDatabase
	} from '$lib/client/local/browser.js';
	import { exportSafeRecoveryData } from '$lib/client/local/recovery-export.js';
	import {
		getRecoveryResetConfirmation,
		resetRecoveredDatabase
	} from '$lib/client/local/recovery.js';
	import { downloadBlob } from '$lib/client/portability/download.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let database = $state<Dexie | null>(null);
	let confirmation = $state('');
	let pending = $state(false);
	let message = $state('Opening the local database without running migrations…');
	let failed = $state(false);
	const requiredConfirmation = $derived(database ? getRecoveryResetConfirmation(database) : '');

	onMount(() => {
		void getBrowserRecoveryDatabase()
			.then((opened) => {
				database = opened;
				message = 'The database is open in recovery-only mode.';
			})
			.catch((error: unknown) => {
				failed = true;
				message =
					error instanceof Error ? error.message : 'The local database could not be opened.';
			});
	});

	const downloadRecovery = async () => {
		if (!database) return;
		pending = true;
		failed = false;
		try {
			const recovery = await exportSafeRecoveryData(database);
			const blob = new Blob([JSON.stringify(recovery, null, 2)], { type: 'application/json' });
			downloadBlob(blob, `maal-recovery-${new Date().toISOString().slice(0, 10)}.json`);
			const skipped = Object.values(recovery.skipped).reduce((total, count) => total + count, 0);
			message = skipped
				? `Recovery export saved. ${skipped} unreadable records were skipped.`
				: 'Recovery export saved.';
		} catch (error) {
			failed = true;
			message = error instanceof Error ? error.message : 'Recovery export failed.';
		} finally {
			pending = false;
		}
	};

	const resetDatabase = async () => {
		if (!database) return;
		pending = true;
		failed = false;
		try {
			await resetRecoveredDatabase(database, confirmation);
			clearBrowserDatabasePromises();
			window.location.assign('/plan');
		} catch (error) {
			failed = true;
			message = error instanceof Error ? error.message : 'The local database was not reset.';
			pending = false;
		}
	};
</script>

<svelte:head><title>Local data recovery · Maal</title></svelte:head>

<main class="grid min-h-svh place-items-center bg-background px-4 py-10 text-foreground">
	<div class="grid w-full max-w-xl gap-5">
		<header class="grid gap-2">
			<p class="text-sm font-medium text-primary">Local data recovery</p>
			<h1 class="text-2xl font-semibold tracking-tight">Save what is readable before resetting</h1>
			<p class="text-sm text-muted-foreground">
				Maal has not attempted another database upgrade and will not reset data automatically.
			</p>
		</header>

		<Alert.Root variant={failed ? 'destructive' : 'default'}>
			<Alert.Title>{failed ? 'Recovery needs attention' : 'Recovery-only mode'}</Alert.Title>
			<Alert.Description>{message}</Alert.Description>
		</Alert.Root>

		<section class="grid gap-3 rounded-xl border bg-card p-4 text-card-foreground">
			<div>
				<h2 class="font-medium">1. Download readable data</h2>
				<p class="text-sm text-muted-foreground">
					This unencrypted JSON excludes profile PINs, auth sessions, billing, sync queues, and UI
					state. Damaged rows are counted and skipped.
				</p>
			</div>
			<Button
				variant="outline"
				disabled={!database || pending}
				onclick={() => void downloadRecovery()}
			>
				<DownloadIcon /> Download recovery JSON
			</Button>
		</section>

		<section
			class="grid gap-3 rounded-xl border border-destructive/40 bg-card p-4 text-card-foreground"
		>
			<div>
				<h2 class="font-medium">2. Reset local data</h2>
				<p class="text-sm text-muted-foreground">
					This permanently deletes this browser’s Maal database. Type
					<code class="rounded bg-muted px-1 py-0.5">{requiredConfirmation || 'RESET …'}</code> to continue.
				</p>
			</div>
			<Input bind:value={confirmation} autocomplete="off" aria-label="Reset confirmation" />
			<Button
				variant="destructive"
				disabled={!database || pending || confirmation !== requiredConfirmation}
				onclick={() => void resetDatabase()}
			>
				<RotateCcwIcon /> Reset local database
			</Button>
		</section>
	</div>
</main>
