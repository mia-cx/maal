const namedHtmlEntities: Record<string, string> = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	nbsp: ' ',
	quot: '"'
};

const codePointCharacter = (codePoint: number): string | undefined => {
	if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return;
	return String.fromCodePoint(codePoint);
};

export const decodeHtmlEntities = (value: string): string =>
	value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (entity, code: string) => {
		if (code.startsWith('#x') || code.startsWith('#X')) {
			return codePointCharacter(Number.parseInt(code.slice(2), 16)) ?? entity;
		}
		if (code.startsWith('#')) {
			return codePointCharacter(Number.parseInt(code.slice(1), 10)) ?? entity;
		}
		return namedHtmlEntities[code.toLowerCase()] ?? entity;
	});

export const cleanImportedText = (value: string): string =>
	decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
