import { toolError } from './results';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const requireNonEmptyText = (value: unknown, name: string): string => {
	const result = text(value);
	if (!result) throw toolError('invalid_input', `${name} is required.`);
	return result;
};

export const optionalNumber = (value: unknown, name = 'number'): number | undefined => {
	if (value === undefined) return undefined;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const number = Number(value);
		if (Number.isFinite(number)) return number;
	}
	throw toolError('invalid_input', `${name} must be a finite number.`);
};

export const arrayOfStrings = (value: unknown, name = 'array'): string[] | undefined => {
	if (value === undefined) return undefined;
	if (!Array.isArray(value))
		throw toolError('invalid_input', `${name} must be an array of strings.`);
	if (value.some((item) => typeof item !== 'string')) {
		throw toolError('invalid_input', `${name} must contain only strings.`);
	}
	return value;
};
