export type FormParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const stringFromForm = (
	value: FormDataEntryValue | null,
	message: string
): FormParseResult<string> => {
	if (typeof value !== 'string') return { ok: false, message };
	return { ok: true, value: value.trim() };
};

export const optionalStringFromForm = (
	value: FormDataEntryValue | null,
	message: string
): FormParseResult<string | null> => {
	if (value === null) return { ok: true, value: null };
	const parsed = stringFromForm(value, message);
	if (!parsed.ok) return parsed;
	return { ok: true, value: parsed.value || null };
};

export const integerFromForm = ({
	value,
	message,
	min,
	max
}: {
	value: FormDataEntryValue | null;
	message: string;
	min?: number;
	max?: number;
}): FormParseResult<number> => {
	const parsed = stringFromForm(value, message);
	if (!parsed.ok) return parsed;
	if (!/^-?\d+$/.test(parsed.value)) return { ok: false, message };
	const number = Number(parsed.value);
	if (!Number.isSafeInteger(number)) return { ok: false, message };
	if (min !== undefined && number < min) return { ok: false, message };
	if (max !== undefined && number > max) return { ok: false, message };
	return { ok: true, value: number };
};

export const optionalIntegerFromForm = (input: {
	value: FormDataEntryValue | null;
	message: string;
	min?: number;
	max?: number;
}): FormParseResult<number | null> => {
	if (input.value === null) return { ok: true, value: null };
	const raw = stringFromForm(input.value, input.message);
	if (!raw.ok) return raw;
	if (!raw.value) return { ok: true, value: null };
	return integerFromForm({ ...input, value: raw.value });
};

export const jsonArrayFromForm = <T>(
	value: FormDataEntryValue | null,
	message: string,
	isItem: (value: unknown) => value is T
): FormParseResult<T[]> => {
	if (value === null) return { ok: true, value: [] };
	const raw = stringFromForm(value, message);
	if (!raw.ok) return raw;
	if (!raw.value) return { ok: true, value: [] };
	try {
		const parsed = JSON.parse(raw.value) as unknown;
		if (!Array.isArray(parsed) || !parsed.every(isItem)) return { ok: false, message };
		return { ok: true, value: parsed };
	} catch {
		return { ok: false, message };
	}
};
