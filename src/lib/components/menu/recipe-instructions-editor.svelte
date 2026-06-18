<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import * as Button from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import type { DraftInstruction } from '$lib/menu/recipe-editor-model';

	let {
		instructionListElement = $bindable(),
		visibleInstructions,
		sortedInstructionCount,
		draggedInstruction,
		instructionDropIndex,
		instructionPositionDrafts,
		textareaClass,
		startInstructionDrag,
		swapInstructionPosition,
		updateInstructionPositionDraft,
		commitInstructionPosition,
		handleInstructionPositionKeydown,
		updateInstructionText,
		removeInstruction,
		addInstruction
	}: {
		instructionListElement?: HTMLElement;
		visibleInstructions: DraftInstruction[];
		sortedInstructionCount: number;
		draggedInstruction: DraftInstruction | null;
		instructionDropIndex: number;
		instructionPositionDrafts: Record<string, string>;
		textareaClass: string;
		startInstructionDrag: (instruction: DraftInstruction, event: PointerEvent) => void;
		swapInstructionPosition: (draftId: string, direction: -1 | 1) => void;
		updateInstructionPositionDraft: (draftId: string, value: string) => void;
		commitInstructionPosition: (draftId: string) => void;
		handleInstructionPositionKeydown: (draftId: string, event: KeyboardEvent) => void;
		updateInstructionText: (draftId: string, value: string) => void;
		removeInstruction: (draftId: string) => void;
		addInstruction: () => void;
	} = $props();
</script>

<section class="grid gap-2">
	<h3 class="text-xs font-medium text-foreground">{m.menu_instructions()}</h3>
	<div bind:this={instructionListElement} role="list" class="grid gap-3">
		{#if draggedInstruction && instructionDropIndex === 0}
			<div class="h-20 rounded-md border border-dashed border-primary/70 bg-primary/10"></div>
		{/if}
		{#each visibleInstructions as instruction, index (instruction.draftId)}
			<div
				data-instruction-row
				role="listitem"
				class="grid gap-2 sm:grid-cols-[4.75rem_minmax(0,1fr)_auto] sm:items-center"
			>
				<div class="flex items-stretch gap-1 text-xs font-medium">
					<button
						type="button"
						aria-label={`Drag instruction ${instruction.position}`}
						class="flex w-3 cursor-grab touch-none items-center justify-center p-0 text-muted-foreground active:cursor-grabbing"
						onpointerdown={(event) => startInstructionDrag(instruction, event)}
					>
						<GripVerticalIcon class="size-4" />
					</button>
					<div class="grid flex-1 gap-1">
						<Button.Root
							type="button"
							variant="outline"
							size="sm"
							class="h-7 px-1"
							disabled={instruction.position === 1}
							aria-label={m.menu_move_instruction_up()}
							onclick={() => swapInstructionPosition(instruction.draftId, -1)}
						>
							<ChevronUpIcon class="size-4" />
						</Button.Root>
						<Input
							type="text"
							inputmode="numeric"
							value={instructionPositionDrafts[instruction.draftId] ?? String(instruction.position)}
							oninput={(event) =>
								updateInstructionPositionDraft(instruction.draftId, event.currentTarget.value)}
							onblur={() => commitInstructionPosition(instruction.draftId)}
							onkeydown={(event) => handleInstructionPositionKeydown(instruction.draftId, event)}
							aria-label={m.menu_instruction_position()}
							class="px-1 text-center"
						/>
						<Button.Root
							type="button"
							variant="outline"
							size="sm"
							class="h-7 px-1"
							disabled={instruction.position === sortedInstructionCount}
							aria-label={m.menu_move_instruction_down()}
							onclick={() => swapInstructionPosition(instruction.draftId, 1)}
						>
							<ChevronDownIcon class="size-4" />
						</Button.Root>
					</div>
				</div>
				<textarea
					value={instruction.text}
					oninput={(event) => updateInstructionText(instruction.draftId, event.currentTarget.value)}
					aria-label={`Instruction ${instruction.position} text`}
					class={`${textareaClass} min-h-[5.75rem]`}
				></textarea>
				<div class="flex flex-wrap gap-1 sm:flex-col sm:self-start">
					<Button.Root
						type="button"
						variant="ghost"
						size="sm"
						onclick={() => removeInstruction(instruction.draftId)}
					>
						{m.menu_remove()}
					</Button.Root>
				</div>
			</div>
			{#if draggedInstruction && instructionDropIndex === index + 1}
				<div class="h-20 rounded-md border border-dashed border-primary/70 bg-primary/10"></div>
			{/if}
		{/each}
	</div>
	<div>
		<Button.Root variant="outline" size="sm" class="w-full" onclick={addInstruction}
			>{m.menu_add_step()}</Button.Root
		>
	</div>
</section>
