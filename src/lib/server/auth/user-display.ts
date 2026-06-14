export const displayUserName = (user: {
	name?: string | null;
	firstName?: string | null;
	lastName?: string | null;
	email: string;
}): string => {
	const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
	return user.name?.trim() || fullName || user.email.split('@')[0] || user.email;
};
