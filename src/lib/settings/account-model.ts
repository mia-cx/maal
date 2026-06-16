export const normalizedEmail = (email: string): string => email.trim().toLowerCase();

export const accountEmailChanged = (nextEmail: string, currentEmail: string): boolean =>
	Boolean(normalizedEmail(nextEmail)) &&
	normalizedEmail(nextEmail) !== normalizedEmail(currentEmail);

export const accountEmailVerified = (nextEmail: string, verifiedEmail: string | null): boolean =>
	Boolean(normalizedEmail(nextEmail)) && verifiedEmail === normalizedEmail(nextEmail);

export const emailVerificationRequired = (
	nextEmail: string,
	currentEmail: string,
	verifiedEmail: string | null
): boolean =>
	accountEmailChanged(nextEmail, currentEmail) && !accountEmailVerified(nextEmail, verifiedEmail);

export const verificationAttemptKey = (email: string, code: string): string => `${email}:${code}`;
