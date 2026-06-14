export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const optionalNumber = (value: unknown): number | undefined => {
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
};

export const arrayOfStrings = (value: unknown): string[] | undefined =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: undefined;
