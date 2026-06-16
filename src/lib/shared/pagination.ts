export type Pagination = {
	offset: number;
	limit: number;
};

export const boundedPagination = (
	value: { offset?: unknown; limit?: unknown },
	defaultLimit: number,
	maxLimit: number
): Pagination => {
	const numberValue = (input: unknown): number | undefined => {
		if (input === null || input === undefined || input === '') return;
		const number = Number(input);
		return Number.isFinite(number) ? number : undefined;
	};

	return {
		offset: Math.max(0, Math.floor(numberValue(value.offset) ?? 0)),
		limit: Math.min(Math.max(1, Math.floor(numberValue(value.limit) ?? defaultLimit)), maxLimit)
	};
};
