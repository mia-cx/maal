import { Schema } from 'effect';

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

export const ServiceWorkerCommandSchema = Schema.Union(
	Schema.Struct({ type: Schema.Literal('SKIP_WAITING'), version: NonEmptyString }),
	Schema.Struct({ type: Schema.Literal('GET_VERSION') })
);

export const ServiceWorkerEventSchema = Schema.Union(
	Schema.Struct({
		type: Schema.Literal('UPDATE_WAITING'),
		version: NonEmptyString,
		critical: Schema.Boolean
	}),
	Schema.Struct({ type: Schema.Literal('SHELL_READY'), version: NonEmptyString })
);

export const UpdateChannelMessageSchema = Schema.Union(
	Schema.Struct({
		type: Schema.Literal('HEARTBEAT'),
		tabId: NonEmptyString,
		sentAt: Schema.Number
	}),
	Schema.Struct({
		type: Schema.Literal('UPDATE_AVAILABLE'),
		tabId: NonEmptyString,
		version: NonEmptyString,
		critical: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('PREPARE_UPDATE'),
		tabId: NonEmptyString,
		requestId: NonEmptyString,
		version: NonEmptyString,
		critical: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('UPDATE_READY'),
		tabId: NonEmptyString,
		requestId: NonEmptyString
	}),
	Schema.Struct({
		type: Schema.Literal('UPDATE_PREPARING'),
		tabId: NonEmptyString,
		requestId: NonEmptyString
	}),
	Schema.Struct({
		type: Schema.Literal('RELOAD'),
		tabId: NonEmptyString,
		version: NonEmptyString
	})
);

export type ServiceWorkerCommand = typeof ServiceWorkerCommandSchema.Type;
export type ServiceWorkerEvent = typeof ServiceWorkerEventSchema.Type;
export type UpdateChannelMessage = typeof UpdateChannelMessageSchema.Type;

export const isServiceWorkerCommand = Schema.is(ServiceWorkerCommandSchema);
export const isServiceWorkerEvent = Schema.is(ServiceWorkerEventSchema);
export const isUpdateChannelMessage = Schema.is(UpdateChannelMessageSchema);
