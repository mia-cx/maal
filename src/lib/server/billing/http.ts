import { Schema } from 'effect';

export const readBillingRequest = async <A, I>(
	request: Request,
	schema: Schema.Schema<A, I>
): Promise<A> => {
	const body = await request.json().catch(() => null);
	try {
		return Schema.decodeUnknownSync(schema)(body);
	} catch {
		throw new BillingRequestError();
	}
};

export class BillingRequestError extends Error {
	readonly _tag = 'BillingRequestError';
	constructor() {
		super('The billing request is invalid.');
	}
}
