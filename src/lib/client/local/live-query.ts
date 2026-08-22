import { liveQuery } from 'dexie';
import { Schema } from 'effect';
import { readable, type Readable } from 'svelte/store';

import { LocalDecodeError } from '$lib/domain/contracts/errors.js';

import type { MaalDatabase } from './database.js';

export interface DecodedLiveQueryOptions<A> {
	database: MaalDatabase;
	schema: Schema.Schema<A>;
	initialValue: A;
	query: (database: MaalDatabase) => Promise<unknown> | unknown;
	onError?: (error: LocalDecodeError) => void;
}

export const createDecodedLiveQuery = <A>({
	database,
	schema,
	initialValue,
	query,
	onError
}: DecodedLiveQueryOptions<A>): Readable<A> =>
	readable(initialValue, (set) => {
		const subscription = liveQuery(async () => {
			const value = await query(database);
			try {
				return Schema.decodeUnknownSync(schema)(value);
			} catch {
				throw new LocalDecodeError({
					operation: 'decode live query',
					message: 'Local query data did not match its contract.'
				});
			}
		}).subscribe({
			next: set,
			error: (error: unknown) => {
				const decodedError =
					typeof error === 'object' && error !== null && '_tag' in error
						? (error as LocalDecodeError)
						: new LocalDecodeError({
								operation: 'run live query',
								message: 'The local query could not be read.'
							});
				onError?.(decodedError);
			}
		});

		return () => subscription.unsubscribe();
	});
