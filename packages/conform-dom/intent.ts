import type { DefaultValue, ResolveResult, SubmissionResult } from './types.js';
import { createSubmitter, requestSubmit } from './dom.js';
import { flatten, isPlainObject, setValue } from './formdata.js';
import { invariant } from './util.js';

export type Intent<Payload = unknown> = {
	type: string;
	serialize(payload: Payload): string;
	deserialize(serializedIntent: string): Payload | null;
	createHandler(
		data: Record<string, unknown>,
		payload: Payload,
	): (result: Omit<Required<SubmissionResult>, 'status'>) => void;
};

export const INTENT = '__intent__';

/**
 * Returns the intent from the form data or search params.
 * It throws an error if multiple intent is set.
 */
export function getIntent(payload: FormData | URLSearchParams): string | null {
	if (!payload.has(INTENT)) {
		return null;
	}

	const [intent, secondIntent, ...rest] = payload.getAll(INTENT);

	// The submitter value is included in the formData directly on Safari 15.6.
	// This causes the intent to be duplicated in the payload.
	// We will ignore the second intent if it is the same as the first one.
	if (
		typeof intent !== 'string' ||
		(secondIntent && intent !== secondIntent) ||
		rest.length > 0
	) {
		throw new Error('The intent could only be set on a button');
	}

	return intent;
}

export function resolve(payload: FormData | URLSearchParams): ResolveResult {
	const state = payload.get('__state__');
	const intent = getIntent(payload);
	const data: Record<string, unknown> = {};
	const fields: string[] = [];

	invariant(
		typeof state === 'string' &&
			(typeof intent === 'string' || intent === null),
		'Invalid form data',
	);

	for (const [name, next] of payload.entries()) {
		if (name === INTENT || name === '__state__') {
			continue;
		}

		fields.push(name);
		setValue(data, name, (prev) => {
			if (!prev) {
				return next;
			} else if (Array.isArray(prev)) {
				return prev.concat(next);
			} else {
				return [prev, next];
			}
		});
	}

	return {
		data,
		intent,
		state: JSON.parse(state),
		fields,
	};
}

export function createIntent(options: {
	type: string;
	update: (
		result: Omit<Required<SubmissionResult>, 'status'>,
		payload: string,
	) => void;
}): Intent<string>;
export function createIntent<Payload>(options: {
	type: string;
	serialize: (payload: Payload) => string;
	deserialize: (serializedPayload: string) => Payload;
	update: (
		result: Omit<Required<SubmissionResult>, 'status'>,
		payload: Payload,
	) => void;
}): Intent<Payload>;
export function createIntent<Payload, Context>(options: {
	type: string;
	serialize: (payload: Payload) => string;
	deserialize: (serializedPayload: string) => Payload;
	preprocess: (data: Record<string, unknown>, payload: Payload) => Context;
	update: (
		result: Omit<Required<SubmissionResult>, 'status'>,
		payload: Payload,
		context: Context,
	) => void;
}): Intent<Payload>;
export function createIntent<Payload, Context>(options: {
	type: string;
	serialize?: (payload: Payload) => string;
	deserialize?: (serializedPayload: string) => Payload;
	preprocess?: (data: Record<string, unknown>, payload: Payload) => Context;
	update: (
		result: Omit<Required<SubmissionResult>, 'status'>,
		payload: Payload,
		context: Context | undefined,
	) => void;
}): Intent<Payload> {
	return {
		type: options.type,
		serialize(payload) {
			return `${options.type}/${options.serialize?.(payload) ?? payload}`;
		},
		deserialize(serializedIntent) {
			const seperatorIndex = serializedIntent.indexOf('/');

			if (seperatorIndex > -1) {
				const type = serializedIntent.slice(0, seperatorIndex);
				const serializedPayload = serializedIntent.slice(seperatorIndex + 1);

				if (type === options.type) {
					return (
						options.deserialize?.(serializedPayload) ??
						(serializedPayload as Payload)
					);
				}
			}

			return null;
		},
		createHandler(data, payload) {
			const context = options.preprocess?.(data, payload);

			return (result) => {
				options.update(result, payload, context);
			};
		},
	};
}

/**
 * Returns the properties required to configure an intent button for validation
 *
 * @see https://conform.guide/api/react#validate
 */
export const validate = createIntent({
	type: 'validate',
	update(result, payload) {
		result.state.validated[payload] = true;
	},
});

export const list = createIntent<
	ListIntentPayload,
	{ defaultListKeys: string[] }
>({
	type: 'list',
	serialize(payload) {
		return JSON.stringify(payload);
	},
	deserialize(serializedPayload) {
		return JSON.parse(serializedPayload);
	},
	preprocess(data, payload) {
		const list = setValue(data, payload.name, (currentValue) => {
			if (typeof currentValue !== 'undefined' && !Array.isArray(currentValue)) {
				throw new Error('The list intent can only be applied to a list');
			}

			return currentValue ?? [];
		});
		// Derive the list keys before updating it
		const defaultListKeys = Object.keys(list);

		updateList(list, payload);

		return {
			defaultListKeys,
		};
	},
	update(result, payload, { defaultListKeys }) {
		const keys = result.state.key[payload.name] ?? defaultListKeys;

		switch (payload.operation) {
			case 'append':
			case 'prepend':
			case 'replace':
				updateState(result.state.validated, payload.name, {
					...payload,
					defaultValue: undefined,
				});
				updateList(keys, {
					...payload,
					defaultValue: (Date.now() * Math.random()).toString(36),
				});
				break;
			default:
				updateState(result.state.validated, payload.name, payload);
				updateList(keys, payload);
				break;
		}

		result.state.key[payload.name] = keys;
		result.state.validated[payload.name] = true;
	},
});

export type ListIntentPayload<Schema = unknown> =
	| { name: string; operation: 'prepend'; defaultValue?: DefaultValue<Schema> }
	| { name: string; operation: 'append'; defaultValue?: DefaultValue<Schema> }
	| {
			name: string;
			operation: 'replace';
			defaultValue: DefaultValue<Schema>;
			index: number;
	  }
	| { name: string; operation: 'remove'; index: number }
	| { name: string; operation: 'reorder'; from: number; to: number };

export function requestIntent(
	form: HTMLFormElement | null | undefined,
	buttonProps: {
		value: string;
		formNoValidate?: boolean;
	},
): void {
	if (!form) {
		// eslint-disable-next-line no-console
		console.warn('No form element is provided');
		return;
	}

	const submitter = createSubmitter({
		name: INTENT,
		value: buttonProps.value,
		hidden: true,
		formNoValidate: buttonProps.formNoValidate,
	});

	requestSubmit(form, submitter);
}

export function getIntentHandler(
	form: ResolveResult,
	intents: Array<Intent> = [validate, list],
): (result: Omit<Required<SubmissionResult>, 'status'>) => void {
	if (form.intent) {
		for (const intent of intents) {
			const payload = intent.deserialize(form.intent);

			if (payload) {
				return intent.createHandler(form.data, payload);
			}
		}

		throw new Error(`Unknown intent: ${form.intent}`);
	}

	return (result) => {
		for (const name of [...form.fields, ...Object.keys(result.error)]) {
			form.state.validated[name] = true;
		}
	};
}

export function updateList<Schema>(
	list: Array<DefaultValue<Schema>>,
	payload: ListIntentPayload<Schema>,
): void {
	switch (payload.operation) {
		case 'prepend':
			list.unshift(payload.defaultValue as any);
			break;
		case 'append':
			list.push(payload.defaultValue as any);
			break;
		case 'replace':
			list.splice(payload.index, 1, payload.defaultValue);
			break;
		case 'remove':
			list.splice(payload.index, 1);
			break;
		case 'reorder':
			list.splice(payload.to, 0, ...list.splice(payload.from, 1));
			break;
		default:
			throw new Error('Unknown list intent received');
	}
}

export function updateState<Schema>(
	data: Record<string, unknown>,
	name: string,
	payload: ListIntentPayload<Schema>,
): void {
	const root = Symbol.for('root');

	// The keys are sorted in desc so that the root value is handled last
	const keys = Object.keys(data).sort((prev, next) => next.localeCompare(prev));
	const target: Record<string, unknown> = {};

	for (const key of keys) {
		const value = data[key];

		if (key.startsWith(name) && key !== name) {
			setValue(target, key, (prev) => {
				if (typeof prev === 'undefined') {
					return value;
				}

				// @ts-expect-error As key is unique, if prev is already defined, it must be either an object or an array
				prev[root] = value;

				return prev;
			});

			// Remove the value from the data
			delete data[key];
		}
	}

	const value = setValue(target, name, (value) => value ?? []);

	if (!Array.isArray(value)) {
		throw new Error('The name provided is not pointed to a list');
	}

	updateList(value, payload);

	Object.assign(
		data,
		flatten(value, {
			resolve(data) {
				if (Array.isArray(data)) {
					return null;
				}

				if (isPlainObject(data)) {
					return data[root] ?? null;
				}

				return data;
			},
			prefix: name,
		}),
	);
}
