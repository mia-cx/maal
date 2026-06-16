export const passwordChangeMismatch = (
	newPassword: string,
	confirmPassword: string
): string | null => (newPassword === confirmPassword ? null : 'Passwords do not match.');

export const emptyPasswordChangeFields = () => ({
	currentPassword: '',
	newPassword: '',
	confirmPassword: ''
});
