<script lang="ts">
	import { onMount } from 'svelte';
	import type Dexie from 'dexie';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';

	import {
		clearBrowserDatabasePromises,
		clearBrowserRecoveryRequired,
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
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';

	let database = $state<Dexie | null>(null);
	let confirmation = $state('');
	let pending = $state(false);
	let message = $state('Checking which local records can be read…');
	let failed = $state(false);
	const requiredConfirmation = $derived(database ? getRecoveryResetConfirmation(database) : '');

	onMount(() => {
		void getBrowserRecoveryDatabase()
			.then((opened) => {
				database = opened;
				message = 'Your local data is ready for a read-only recovery export.';
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
			clearBrowserRecoveryRequired();
			window.location.assign('/plan');
		} catch (error) {
			failed = true;
			message = error instanceof Error ? error.message : 'The local database was not reset.';
			pending = false;
		}
	};

	const retryStartup = () => {
		clearBrowserRecoveryRequired();
		clearBrowserDatabasePromises();
		window.location.assign('/plan');
	};
</script>

<svelte:head><title>Local data recovery · Maal</title></svelte:head>

<main
	class="grid min-h-svh place-items-center overflow-y-auto bg-background px-4 py-10 text-foreground"
>
	<div class="grid w-full max-w-xl gap-6">
		<header class="grid gap-4">
			<WordmarkLogo class="h-6 w-auto justify-self-start" />
			<div class="grid gap-2">
				<p class="text-sm font-medium text-primary">Local data recovery</p>
				<h1 class="text-2xl font-semibold tracking-tight text-balance">
					Save your readable data first
				</h1>
				<p class="text-sm text-muted-foreground text-pretty">
					Normal startup has stopped. Maal will not sync, change, or reset local data on this
					screen.
				</p>
			</div>
		</header>

		<Alert.Root variant={failed ? 'destructive' : 'default'}>
			<Alert.Title>{failed ? 'Recovery needs attention' : 'Recovery-only mode'}</Alert.Title>
			<Alert.Description>{message}</Alert.Description>
		</Alert.Root>
		<div>
			<Button variant="ghost" class="min-h-11" onclick={retryStartup}>
				Try normal startup again
			</Button>
		</div>

		<section class="grid gap-4 rounded-xl border bg-card p-5 text-card-foreground">
			<div>
				<h2 class="font-medium">Download readable data</h2>
				<p class="mt-1 text-sm text-muted-foreground text-pretty">
					This unencrypted JSON excludes profile PINs, auth sessions, billing, sync queues, and UI
					state. Damaged rows are counted and skipped.
				</p>
			</div>
			<Button
				size="lg"
				class="min-h-11 w-full sm:w-fit"
				disabled={!database || pending}
				onclick={() => void downloadRecovery()}
			>
				<DownloadIcon /> Download recovery JSON
			</Button>
		</section>

		<section
			class="grid gap-4 rounded-xl border border-destructive/40 bg-card p-5 text-card-foreground"
		>
			<div>
				<h2 class="font-medium text-destructive">Reset local data</h2>
				<p class="mt-1 text-sm text-muted-foreground text-pretty">
					This permanently deletes this browser’s Maal database. Type
					<code class="rounded bg-muted px-1 py-0.5">{requiredConfirmation || 'RESET …'}</code> to continue.
				</p>
			</div>
			<Input
				class="min-h-11 text-base sm:text-sm"
				bind:value={confirmation}
				autocomplete="off"
				aria-label="Reset confirmation"
			/>
			<Button
				variant="destructive"
				size="lg"
				class="min-h-11 w-full sm:w-fit"
				disabled={!database || pending || confirmation !== requiredConfirmation}
				onclick={() => void resetDatabase()}
			>
				<RotateCcwIcon /> Reset local database
			</Button>
		</section>
	</div>
</main>
