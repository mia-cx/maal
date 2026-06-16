export const verificationCodeLength = 6;

export const normalizeVerificationCode = (value: unknown): string =>
	typeof value === 'string' ? value.trim() : '';

export const isVerificationCode = (value: string, length = verificationCodeLength): boolean =>
	new RegExp(`^\\d{${length}}$`).test(value);
