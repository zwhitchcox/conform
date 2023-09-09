import type { DefaultValue, FormContext, SubmissionResult } from './types.js';
import { createSubmitter, requestSubmit } from './dom.js';
import { setValue } from './formdata.js';
import { invariant } from './util.js';

export type Intent<Payload = unknown> = {
	type: string;
	serialize(payload: Payload): string;
	deserialize(serializedIntent: string): Payload | null;
	createHandler(
		data: Record<string, unknown>,
		payload: Payload,
	): (result: SubmissionResult) => void;
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

export function resolve(payload: FormData | URLSearchParams): FormContext {
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
	update: (result: SubmissionResult, payload: string) => void;
}): Intent<string>;
export function createIntent<Payload>(options: {
	type: string;
	serialize: (payload: Payload) => string;
	deserialize: (serializedPayload: string) => Payload;
	update: (result: SubmissionResult, payload: Payload) => void;
}): Intent<Payload>;
export function createIntent<Payload, Context>(options: {
	type: string;
	serialize: (payload: Payload) => string;
	deserialize: (serializedPayload: string) => Payload;
	preprocess: (data: Record<string, unknown>, payload: Payload) => Context;
	update: (
		result: SubmissionResult,
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
		result: SubmissionResult,
		payload: Payload,
		context: Context | undefined,
	) => void;
}): Intent<Payload> {
	return {
		type: options.type,
		serialize(payload: Payload): string {
			return `${options.type}/${options.serialize?.(payload) ?? payload}`;
		},
		deserialize(serializedIntent: string): Payload | null {
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
		createHandler(data: Record<string, unknown>, payload: Payload) {
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
		const keys = result.state.listKeys[payload.name] ?? defaultListKeys;

		switch (payload.operation) {
			case 'append':
			case 'prepend':
			case 'replace':
				updateList(keys, {
					...payload,
					defaultValue: (Date.now() * Math.random()).toString(36),
				});
				break;
			default:
				updateList(keys, payload);
				break;
		}

		result.state.listKeys[payload.name] = keys;

		if (payload.operation === 'remove' || payload.operation === 'replace') {
			for (const name of Object.keys(result.state.validated)) {
				if (name.startsWith(`${payload.name}[${payload.index}]`)) {
					result.state.validated[name] = false;
				}
			}
		}

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
	form: FormContext,
	intents: Array<Intent> = [validate, list],
): (result: SubmissionResult) => void {
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
