<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import UploadIcon from '@lucide/svelte/icons/upload';

	import { decodePortableArchive } from '$lib/client/portability/archive.js';
	import { downloadPortableArchive } from '$lib/client/portability/download.js';
	import {
		commitPortableImport,
		planPortableImport,
		type ImportResolution,
		type PortableImportPlan
	} from '$lib/client/portability/import.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import type { PortableArchive } from '$lib/domain/portability/schema.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as NativeSelect from '$lib/components/ui/native-select/index.js';

	let {
		database,
		profileId,
		open = $bindable(false)
	}: { database: MaalDatabase; profileId: string | null; open?: boolean } = $props();

	let archive = $state<PortableArchive | null>(null);
	let plan = $state<PortableImportPlan | null>(null);
	let resolutions = $state<Record<string, ImportResolution>>({});
	let fileName = $state('');
	let pending = $state(false);
	let message = $state('');
	let failed = $state(false);

	const totalWrites = $derived(
		plan ? Object.values(plan.summary).reduce((total, count) => total + count, 0) : 0
	);

	const errorMessage = (error: unknown): string =>
		error instanceof Error ? error.message : 'That operation could not be completed.';

	const exportData = async () => {
		if (!profileId) return;
		pending = true;
		message = '';
		failed = false;
		try {
			await downloadPortableArchive(database, profileId);
			message = 'Your local archive is ready.';
		} catch (error) {
			failed = true;
			message = errorMessage(error);
		} finally {
			pending = false;
		}
	};

	const buildPlan = async (nextArchive: PortableArchive) => {
		if (!profileId) return;
		plan = await planPortableImport(database, nextArchive, profileId, resolutions);
	};

	const chooseFile = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		pending = true;
		message = '';
		failed = false;
		archive = null;
		plan = null;
		resolutions = {};
		fileName = file.name;
		try {
			archive = await decodePortableArchive(file);
			await buildPlan(archive);
		} catch (error) {
			failed = true;
			message = errorMessage(error);
		} finally {
			pending = false;
			input.value = '';
		}
	};

	const resolveCollision = async (collisionId: string, resolution: ImportResolution) => {
		if (!archive) return;
		resolutions = { ...resolutions, [collisionId]: resolution };
		pending = true;
		message = '';
		failed = false;
		try {
			await buildPlan(archive);
		} catch (error) {
			failed = true;
			message = errorMessage(error);
		} finally {
			pending = false;
		}
	};

	const resolveCollisionKind = async (
		kind: 'primary-id' | 'natural-key',
		resolution: 'keep-local' | 'replace'
	) => {
		if (!archive || !plan) return;
		resolutions = {
			...resolutions,
			...Object.fromEntries(
				plan.collisions
					.filter((collision) => collision.kind === kind)
					.map(({ collisionId }) => [collisionId, resolution])
			)
		};
		pending = true;
		message = '';
		failed = false;
		try {
			await buildPlan(archive);
		} catch (error) {
			failed = true;
			message = errorMessage(error);
		} finally {
			pending = false;
		}
	};

	const importData = async () => {
		if (!plan || plan.unresolvedCollisionIds.length > 0) return;
		pending = true;
		message = '';
		failed = false;
		try {
			await commitPortableImport(database, plan);
			message = `Imported ${totalWrites} records from ${fileName}.`;
			archive = null;
			plan = null;
			resolutions = {};
		} catch (error) {
			failed = true;
			message = errorMessage(error);
		} finally {
			pending = false;
		}
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[min(44rem,calc(100vh-2rem))] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Import or export data</Dialog.Title>
			<Dialog.Description>
				Archives let you move or back up everything this profile can see. They do not include
				sign-in, billing, sync, or device settings.
			</Dialog.Description>
		</Dialog.Header>

		<Alert.Root>
			<FileArchiveIcon />
			<Alert.Title>Keep archives private</Alert.Title>
			<Alert.Description>
				The ZIP is not encrypted and may include recipes, meal history, check-ins, and household
				preferences.
			</Alert.Description>
		</Alert.Root>

		<section class="grid gap-2 rounded-lg border p-3">
			<div>
				<h3 class="text-sm font-medium">Export this profile</h3>
				<p class="text-xs text-muted-foreground">Works entirely on this device.</p>
			</div>
			<Button variant="outline" disabled={pending || !profileId} onclick={() => void exportData()}>
				<DownloadIcon /> Export Maal archive
			</Button>
		</section>

		<section class="grid gap-3 rounded-lg border p-3">
			<div>
				<h3 class="text-sm font-medium">Import into this profile</h3>
				<p class="text-xs text-muted-foreground">
					Maal checks the whole archive before changing local data.
				</p>
			</div>
			<label
				class="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
			>
				<UploadIcon class="size-4" /> Choose Maal archive
				<input
					class="sr-only"
					type="file"
					accept=".zip,application/zip"
					disabled={pending || !profileId}
					onchange={(event) => void chooseFile(event)}
				/>
			</label>

			{#if plan}
				<div class="grid gap-1 text-xs">
					<p><span class="font-medium">{fileName}</span> · {totalWrites} records ready</p>
					{#each plan.warnings as warning, warningIndex (warningIndex)}
						<p class="text-muted-foreground">{warning}</p>
					{/each}
				</div>

				{#if plan.collisions.length > 0}
					<div class="grid gap-2">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h4 class="text-xs font-medium">Choose how to handle matching records</h4>
							<div class="flex gap-1">
								<Button
									size="xs"
									variant="ghost"
									disabled={pending}
									onclick={() => void resolveCollisionKind('primary-id', 'keep-local')}
									>Keep same-ID local</Button
								>
								<Button
									size="xs"
									variant="ghost"
									disabled={pending}
									onclick={() => void resolveCollisionKind('primary-id', 'replace')}
									>Replace same-ID</Button
								>
								<Button
									size="xs"
									variant="ghost"
									disabled={pending}
									onclick={() => void resolveCollisionKind('natural-key', 'keep-local')}
									>Keep same-name local</Button
								>
								<Button
									size="xs"
									variant="ghost"
									disabled={pending}
									onclick={() => void resolveCollisionKind('natural-key', 'replace')}
									>Replace same-name</Button
								>
							</div>
						</div>
						{#each plan.collisions as collision (collision.collisionId)}
							<div class="flex items-center justify-between gap-3 rounded-md bg-muted/50 p-2">
								<p class="min-w-0 truncate text-xs">
									{collision.store} · {collision.kind === 'primary-id' ? 'same ID' : 'same name'}
								</p>
								<NativeSelect.Root
									class="w-36 shrink-0"
									value={resolutions[collision.collisionId] ?? ''}
									onchange={(event) =>
										void resolveCollision(
											collision.collisionId,
											(event.currentTarget as HTMLSelectElement).value as ImportResolution
										)}
								>
									<option value="" disabled>Choose…</option>
									{#if collision.allowedResolutions.includes('keep-local')}
										<option value="keep-local">Keep local</option>
									{/if}
									{#if collision.allowedResolutions.includes('replace')}
										<option value="replace">Replace local</option>
									{/if}
									{#if collision.allowedResolutions.includes('import-as-copy')}
										<option value="import-as-copy">Import a copy</option>
									{/if}
								</NativeSelect.Root>
							</div>
						{/each}
					</div>
				{/if}

				<Button
					disabled={pending || plan.unresolvedCollisionIds.length > 0}
					onclick={() => void importData()}
				>
					<UploadIcon /> Import {totalWrites} records
				</Button>
			{/if}
		</section>

		{#if message}
			<p class:text-destructive={failed} class="text-sm" role="status">{message}</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>
