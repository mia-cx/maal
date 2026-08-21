<script lang="ts">
	import * as Button from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import type { DraftInstruction } from '$lib/menu/recipe-editor-model';

	let {
		instruction,
		x,
		y,
		offsetX,
		offsetY,
		width
	}: {
		instruction: DraftInstruction | null;
		x: number;
		y: number;
		offsetX: number;
		offsetY: number;
		width: number;
	} = $props();
</script>

{#if instruction}
	<div
		class="pointer-events-none fixed z-[90] opacity-80 drop-shadow-xl"
		style={`left: ${x - offsetX}px; top: ${y - offsetY}px; width: ${width}px; max-width: calc(100vw - 2rem);`}
	>
		<div
			class="grid gap-2 rounded-md border border-border bg-popover p-2 sm:grid-cols-[4.75rem_minmax(0,1fr)] sm:items-center"
		>
			<div class="flex items-stretch gap-1 text-xs font-medium">
				<span class="flex w-3 items-center justify-center text-muted-foreground">
					<GripVerticalIcon class="size-4" />
				</span>
				<div class="grid flex-1 gap-1">
					<Button.Root type="button" variant="outline" size="sm" class="h-7 px-1" disabled>
						<ChevronUpIcon class="size-4" />
					</Button.Root>
					<Input
						type="text"
						value={String(instruction.position)}
						readonly
						class="px-1 text-center"
					/>
					<Button.Root type="button" variant="outline" size="sm" class="h-7 px-1" disabled>
						<ChevronDownIcon class="size-4" />
					</Button.Root>
				</div>
			</div>
			<p
				class="min-h-[5.75rem] rounded-md border border-input bg-input/20 px-2 py-1.5 text-sm leading-relaxed"
			>
				{instruction.text}
			</p>
		</div>
	</div>
{/if}
