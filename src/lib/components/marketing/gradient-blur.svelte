<script lang="ts">
	import { stripUnit, type GradientOptions, type LengthUnit } from './vesta-utils';
	import type { HTMLAttributes } from 'svelte/elements';

	type GradientBlurProps = {
		blur: `${number}${LengthUnit}` | number;
		detail: number;
		mask: GradientOptions;
	};

	let {
		blur = `24px`,
		detail = 8,
		mask = { type: 'linear', angle: 'to top' },
		class: className = '',
		...restProps
	}: HTMLAttributes<HTMLDivElement> & GradientBlurProps & { class?: string } = $props();

	// exponentially space blur values from 0 to blur, in steps of {detail}
	// using the formula: f(x) = 0.5^8 blur 2^(8x)
	const blurValues = $derived(
		Array.from({ length: detail }, (_, i) => {
			const [number, unit] = typeof blur === 'number' ? [blur, 'px'] : stripUnit(blur);
			const a = i / (detail - 1);
			return `${0.5 ** 8 * number * 2 ** (8 * a)}${unit}`;
		})
	);

	const getMaskStops = (i: number) => {
		const stops: string[] = [];
		for (let j = 0; j < 4; j++) {
			const a = (i + j) / (detail + 1);
			stops.push(`--mask-stop-${j + 1}: ${j == 0 || j == 3 ? 'transparent' : 'black'} ${a * 100}%`);
		}
		return stops.join('; ');
	};

	const getMask = (i: number, mask: GradientOptions) => {
		if (mask.type === 'linear') {
			return `linear-gradient(${mask.angle}, var(--mask-stop-1), var(--mask-stop-2), var(--mask-stop-3), var(--mask-stop-4))`;
		}
		return `radial-gradient(${mask.position}, var(--mask-stop-1), var(--mask-stop-2), var(--mask-stop-3), var(--mask-stop-4))`;
	};
</script>

<div class="pointer-events-none absolute -inset-4 {className}" {...restProps}>
	{#each blurValues as blurValue, i (i)}
		<div
			class="absolute inset-0 z-(--z-index) mask-(--mask-image) supports-backdrop-filter:backdrop-blur-(--blur)"
			style={`--z-index: ${i}; --blur: ${blurValue}; ${getMaskStops(i)}; --mask-image: ${getMask(i, mask)}`}
		></div>
	{/each}
</div>
