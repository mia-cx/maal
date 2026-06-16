import { error, isHttpError, json, type RequestHandler } from '@sveltejs/kit';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { readJsonObject } from '$lib/server/http/request';
import { isVerificationCode, normalizeVerificationCode } from '$lib/settings/verification-code';

const issuer = 'Maal';

type WorkOSAuthFactor = {
	id: string;
	userId: string;
	type: 'totp';
	totp: { issuer: string; user: string; qrCode?: string; secret?: string; uri?: string };
	createdAt: string;
	updatedAt: string;
};

type PublicAuthFactor = {
	id: string;
	type: 'totp';
	issuer: string;
	user: string;
	createdAt: string;
	updatedAt: string;
};

type AutoPaginatable<T> = {
	data?: T[];
	autoPagination?: () => Promise<T[]>;
};

const publicFactor = (factor: WorkOSAuthFactor): PublicAuthFactor => ({
	id: factor.id,
	type: 'totp',
	issuer: factor.totp.issuer,
	user: factor.totp.user,
	createdAt: factor.createdAt,
	updatedAt: factor.updatedAt
});

const listTotpFactors = async (
	platform: App.Platform | undefined,
	userId: string
): Promise<WorkOSAuthFactor[]> => {
	const response = (await createAuthRuntime(platform).workos.multiFactorAuth.listUserAuthFactors({
		userId
	})) as AutoPaginatable<WorkOSAuthFactor>;
	const factors = response.autoPagination ? await response.autoPagination() : (response.data ?? []);
	return factors.filter((factor) => factor.type === 'totp');
};

const requireOwnedFactor = async (
	platform: App.Platform | undefined,
	userId: string,
	factorId: string
): Promise<WorkOSAuthFactor> => {
	const factor = (await listTotpFactors(platform, userId)).find(
		(candidate) => candidate.id === factorId
	);
	if (!factor) error(404, { message: 'Authentication factor not found.' });
	return factor;
};

const factorIdFromBody = (body: Record<string, unknown>): string => {
	const factorId = typeof body.factorId === 'string' ? body.factorId : '';
	if (!factorId) error(400, { message: 'Authentication factor is required.' });
	return factorId;
};

const readVerification = async (
	request: Request
): Promise<{ factorId: string; challengeId: string; code: string }> => {
	const body = await readJsonObject(request);
	const factorId = factorIdFromBody(body);
	const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
	if (!challengeId) error(400, { message: 'Authenticator setup session is required.' });

	const code = normalizeVerificationCode(body.code);
	if (!isVerificationCode(code)) error(400, { message: 'Enter the 6-digit verification code.' });
	return { factorId, challengeId, code };
};

export const GET: RequestHandler = async ({ locals, platform }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	try {
		const factors = await listTotpFactors(platform, session.user.id);
		return json({ factors: factors.map(publicFactor) });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to list MFA factors', cause);
		error(502, { message: 'Could not load two-factor methods.' });
	}
};

export const POST: RequestHandler = async ({ locals, platform }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	try {
		const enrollment = await createAuthRuntime(
			platform
		).workos.multiFactorAuth.createUserAuthFactor({
			userId: session.user.id,
			type: 'totp',
			totpIssuer: issuer,
			totpUser: session.user.email
		});

		return json({
			factorId: enrollment.authenticationFactor.id,
			challengeId: enrollment.authenticationChallenge.id,
			qrCode: enrollment.authenticationFactor.totp.qrCode,
			secret: enrollment.authenticationFactor.totp.secret
		});
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to start MFA setup', cause);
		error(502, { message: 'Could not start two-factor setup.' });
	}
};

export const PUT: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	const { factorId, challengeId, code } = await readVerification(request);

	try {
		const runtime = createAuthRuntime(platform);
		const result = await runtime.workos.multiFactorAuth.verifyChallenge({
			authenticationChallengeId: challengeId,
			code
		});
		if (!result.valid) error(400, { message: 'That code did not match.' });
		if (result.challenge.authenticationFactorId !== factorId) {
			error(400, { message: 'Authenticator setup session is invalid.' });
		}

		await requireOwnedFactor(platform, session.user.id, factorId);

		const factors = await listTotpFactors(platform, session.user.id);
		await Promise.all(
			factors
				.filter((factor) => factor.id !== factorId)
				.map((factor) => runtime.workos.multiFactorAuth.deleteFactor(factor.id))
		);

		const refreshedFactors = await listTotpFactors(platform, session.user.id);
		return json({ verified: true, factors: refreshedFactors.map(publicFactor) });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to verify MFA setup', cause);
		error(400, { message: 'That code did not match.' });
	}
};

export const DELETE: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	const factorId = factorIdFromBody(await readJsonObject(request));

	try {
		await requireOwnedFactor(platform, session.user.id, factorId);
		await createAuthRuntime(platform).workos.multiFactorAuth.deleteFactor(factorId);
		const factors = await listTotpFactors(platform, session.user.id);
		return json({ factors: factors.map(publicFactor) });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to delete MFA factor', cause);
		error(502, { message: 'Could not remove two-factor method.' });
	}
};
