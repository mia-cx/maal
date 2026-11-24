<script lang="ts">
	import type { EaseFunction, GradientOptions } from './vesta-utils';
	import { easeOutQuad, parseColor, interpolateColor } from './vesta-utils';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		easeFunction = easeOutQuad,
		detail = 8,
		class: className,
		gradient = {
			type: 'linear',
			angle: 'to top',
			stops: ['rgba(0, 0, 0, 1) 0%', 'rgba(0, 0, 0, 0) 100%']
		},
		...restProps
	}: {
		easeFunction?: EaseFunction;
		detail?: number;
		class?: string;
		gradient?: GradientOptions;
	} & HTMLAttributes<HTMLDivElement> = $props();

	function parseStop(stop: string): { color: string; position: number } {
		// Match color and position: "color position" or "color"
		const match = stop.match(
			/^(.+?)\s+(\d+(?:\.\d+)?)(%|px|em|rem|ch|ex|vw|vh|vmin|vmax|cm|mm|in|pt|pc)$/
		);
		if (match) {
			return {
				color: match[1].trim(),
				position: parseFloat(match[2])
			};
		}
		// If no position found, treat as color only (default to 0%)
		return {
			color: stop.trim(),
			position: 0
		};
	}

	function isCSSVariable(color: string): boolean {
		return color.startsWith('var(') || color === 'transparent';
	}

	function generateEasedGradientCSS(
		gradient: GradientOptions,
		easeFn: EaseFunction,
		detail: number
	): string {
		const stopsArray = gradient.stops || [];
		if (stopsArray.length === 0) {
			return '';
		}

		// Parse stops into color and position
		const parsedStops = stopsArray.map((stop: string) => {
			const parsed = parseStop(stop);
			const isVar = isCSSVariable(parsed.color);
			return {
				...parsed,
				isCSSVariable: isVar,
				// Only parse color if it's not a CSS variable
				parsedColor: isVar ? null : parseColor(parsed.color)
			};
		});

		// Generate eased stops between each pair of consecutive stops
		const easedStops: string[] = [];

		for (let i = 0; i < parsedStops.length - 1; i++) {
			const fromStop = parsedStops[i];
			const toStop = parsedStops[i + 1];
			const fromPos = fromStop.position;
			const toPos = toStop.position;
			const range = toPos - fromPos;

			// If either stop is a CSS variable, we can't parse/interpolate colors, so use linear interpolation
			const canInterpolate = !fromStop.isCSSVariable && !toStop.isCSSVariable;

			// Generate detail stops between this pair
			// Stops are evenly spaced, but colors are interpolated using the easing function
			const startJ = i === 0 ? 0 : 1;
			for (let j = startJ; j <= detail; j++) {
				const t = j / detail;
				// Position is evenly spaced (linear)
				const position = fromPos + range * t;
				// Apply easing function to determine color interpolation
				const easedT = easeFn(t);

				let color: string;
				if (canInterpolate && fromStop.parsedColor && toStop.parsedColor) {
					// Both are regular colors - interpolate color using eased value
					color = interpolateColor(fromStop.parsedColor, toStop.parsedColor, easedT);
				} else {
					// CSS variables - use color-mix() with eased percentage
					// Note: color-mix percentage is for the second color
					const mixPercent = easedT * 100;
					color = `color-mix(in oklch, ${fromStop.color}, ${toStop.color} ${mixPercent}%)`;
				}

				easedStops.push(`${color} ${position.toFixed(2)}%`);
			}
		}

		const stopsString = easedStops.join(', ');

		if (gradient.type === 'linear') {
			return `linear-gradient(${gradient.angle}, ${stopsString})`;
		} else {
			return `radial-gradient(${gradient.position || 'at center'}, ${stopsString})`;
		}
	}

	const gradientCSS = $derived.by(() => generateEasedGradientCSS(gradient, easeFunction, detail));
</script>

<div
	class="pointer-events-none {className ?? ''}"
	style="background-image: {gradientCSS};"
	{...restProps}
></div>

<style lang="scss">
	div {
		background-repeat: no-repeat;
		background-size: 100% 100%;
	}
</style>
