export type LengthUnit =
	| 'px'
	| 'rem'
	| 'em'
	| '%'
	| 'vh'
	| 'vw'
	| 'svh'
	| 'svw'
	| 'dvh'
	| 'dvw'
	| 'vmin'
	| 'vmax'
	| 'ch'
	| 'ex'
	| 'cm'
	| 'mm'
	| 'in'
	| 'pt'
	| 'pc';

export type EaseFunction = (t: number) => number;
export type LinearGradientOptions = { type: 'linear'; angle: string; stops?: string[] };
export type RadialGradientOptions = { type: 'radial'; position?: string; stops?: string[] };
export type GradientOptions = LinearGradientOptions | RadialGradientOptions;
export type ParsedColor = { r: number; g: number; b: number; a: number };

export const stripUnit = (value: string): [number, string] => {
	const match = value.match(/^(-?\d*\.?\d+)([a-z%]+)$/i);
	return match ? [Number(match[1]), match[2]] : [Number.parseFloat(value), 'px'];
};

export const easeOutQuad: EaseFunction = (t) => 1 - (1 - t) * (1 - t);

export const parseColor = (color: string): ParsedColor => {
	const hex = color.trim().replace(/^#/, '');
	if (hex.length === 3) {
		return {
			r: Number.parseInt(hex[0] + hex[0], 16),
			g: Number.parseInt(hex[1] + hex[1], 16),
			b: Number.parseInt(hex[2] + hex[2], 16),
			a: 1
		};
	}
	if (hex.length === 6) {
		return {
			r: Number.parseInt(hex.slice(0, 2), 16),
			g: Number.parseInt(hex.slice(2, 4), 16),
			b: Number.parseInt(hex.slice(4, 6), 16),
			a: 1
		};
	}
	const rgba = color.match(/rgba?\(([^)]+)\)/);
	if (rgba) {
		const [r = '0', g = '0', b = '0', a = '1'] = rgba[1].split(',').map((part) => part.trim());
		return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
	}
	return { r: 0, g: 0, b: 0, a: 1 };
};

export const interpolateColor = (from: ParsedColor, to: ParsedColor, t: number): string => {
	const r = Math.round(from.r + (to.r - from.r) * t);
	const g = Math.round(from.g + (to.g - from.g) * t);
	const b = Math.round(from.b + (to.b - from.b) * t);
	const a = from.a + (to.a - from.a) * t;
	return `rgba(${r}, ${g}, ${b}, ${a})`;
};
