import type { MaalDatabase } from '$lib/client/local/database.js';

import { exportPortableArchive } from './archive.js';

const safeFilePart = (value: string): string =>
	value
		.normalize('NFKD')
		.replace(/[^a-zA-Z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.toLocaleLowerCase('en-US') || 'profile';

export const portableArchiveFileName = (displayName: string, createdAt = new Date()): string =>
	`maal-${safeFilePart(displayName)}-${createdAt.toISOString().slice(0, 10)}.zip`;

export const downloadBlob = (blob: Blob, fileName: string): void => {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.hidden = true;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const downloadPortableArchive = async (
	database: MaalDatabase,
	profileId: string
): Promise<void> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new TypeError('The export profile is no longer available.');
	const blob = await exportPortableArchive(database, profileId);
	downloadBlob(blob, portableArchiveFileName(profile.displayName));
};
