export const readSettingsError = async (response: Response, fallback: string): Promise<string> => {
	try {
		const body = (await response.json()) as { message?: unknown };
		if (typeof body.message === 'string' && body.message.trim()) return body.message;
	} catch {
		// Keep the UI message generic when the server response is not JSON.
	}
	return fallback;
};
