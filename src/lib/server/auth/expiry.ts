export const parseTimestamp = (value: string | null | undefined): number | null => {
	if (!value) return null;
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? null : timestamp;
};

export const timestampExpired = (value: string | null | undefined, now = Date.now()): boolean => {
	if (!value) return false;
	const timestamp = parseTimestamp(value);
	return timestamp === null || timestamp <= now;
};
