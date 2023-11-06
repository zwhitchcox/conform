import { flatten, getFormData, getValidationMessage } from './formdata.js';
import {
	isFieldElement,
	getFormAction,
	getFormEncType,
	getFormMethod,
	focusFirstInvalidField,
} from './dom.js';
import type {
	FieldElement,
	FormMetadata,
	Submission,
	SubmissionContext,
	SubmissionResult,
	DefaultValue,
	FormState,
	Constraint,
} from './types.js';
import { invariant } from './util.js';
import { requestIntent, resolve, validate } from './intent.js';

export interface FormContext {
	metadata: FormMetadata;
	initialValue: Record<string, unknown>;
	value: Record<string, unknown>;
	error: Record<string, string[]>;
	state: FormState;
}

export interface FormOptions<Type> {
	defaultValue?: DefaultValue<Type>;
	constraint?: Record<string, Constraint>;
	lastResult?: SubmissionResult;
	shouldValidate?: 'onSubmit' | 'onBlur' | 'onInput';
	shouldRevalidate?: 'onSubmit' | 'onBlur' | 'onInput';
	onValidate?: (context: SubmissionContext) => Submission<Type>;
}

export type SubscriptionSubject = {
	[key in
		| 'error'
		| 'defaultValue'
		| 'value'
		| 'key'
		| 'validated'
		| 'valid'
		| 'dirty']?: SubscriptionScope;
};

export type SubscriptionScope = {
	parent?: string[];
	name?: string[];
};

export interface Form<Type extends Record<string, unknown> = any> {
	id: string;
	submit(event: SubmitEvent): {
		formData: FormData;
		action: ReturnType<typeof getFormAction>;
		encType: ReturnType<typeof getFormEncType>;
		method: ReturnType<typeof getFormMethod>;
		submission?: Submission<Type>;
	};
	reset(event: Event): void;
	input(event: Event): void;
	blur(event: Event): void;
	report(result: SubmissionResult): void;
	update(options: Omit<FormOptions<Type>, 'lastResult'>): void;
	subscribe(
		callback: () => void,
		getSubject?: () => SubscriptionSubject | undefined,
	): () => void;
	getContext(): FormContext;
}

export function createForm<Type extends Record<string, unknown> = any>(
	formId: string,
	options: FormOptions<Type>,
): Form<Type> {
	let subscribers: Array<{
		callback: () => void;
		getSubject?: () => SubscriptionSubject | undefined;
	}> = [];
	let latestOptions = options;
	let context = initializeFormContext();

	function getFormElement(): HTMLFormElement {
		const element = document.forms.namedItem(formId);
		invariant(element !== null, `Form#${formId} does not exist`);
		return element;
	}

	function initializeFormContext(): FormContext {
		const metadata: FormMetadata = initializeMetadata(options);
		const value = options.lastResult?.initialValue
			? flatten(options.lastResult.initialValue)
			: metadata.defaultValue;
		const error = options.lastResult?.error ?? {};

		return {
			metadata,
			initialValue: value,
			value,
			error,
			state: {
				key: options.lastResult?.state?.key ?? {},
				validated: options.lastResult?.state?.validated ?? {},
				valid: createValidProxy(error),
				dirty: createDirtyProxy(metadata.defaultValue, value),
			},
		};
	}

	function createValidProxy(
		error: Record<string, string[]>,
	): Record<string, boolean> {
		const cache: Record<string, boolean> = {};

		return new Proxy(
			{},
			{
				get(_, name: string) {
					return (cache[name] ??= (error[name] ?? []).length === 0);
				},
			},
		);
	}

	function createDirtyProxy(
		defaultValue: Record<string, unknown>,
		value: Record<string, unknown>,
	): Record<string, boolean> {
		const cache: Record<string, boolean> = {};

		return new Proxy(
			{},
			{
				get(_, name: string) {
					return (cache[name] ??=
						JSON.stringify(defaultValue[name]) !== JSON.stringify(value[name]));
				},
			},
		);
	}

	function initializeMetadata(options: FormOptions<Type>): FormMetadata {
		return {
			defaultValue: flatten(options.defaultValue),
			constraint: options.constraint ?? {},
		};
	}

	function shouldNotify<Type>(config: {
		prev: Record<string, Type>;
		next: Record<string, Type>;
		compareFn: (prev: Type | undefined, next: Type | undefined) => boolean;
		cache: Record<string, boolean>;
		scope: SubscriptionScope;
	}): boolean {
		const parents = config.scope.parent ?? [];
		const names = config.scope.name ?? [];
		const list =
			parents.length === 0
				? names
				: Array.from(
						new Set([...Object.keys(config.prev), ...Object.keys(config.next)]),
				  );

		for (const name of list) {
			if (
				parents.length === 0 ||
				names.includes(name) ||
				parents.includes(name) ||
				parents.some((parent) => name.startsWith(`${parent}.`)) ||
				parents.some((parent) => name.startsWith(`${parent}[`))
			) {
				config.cache[name] ??= config.compareFn(
					config.prev[name],
					config.next[name],
				);

				if (config.cache[name]) {
					return true;
				}
			}
		}

		return false;
	}

	function updateContext(update: FormContext) {
		const diff: Record<keyof SubscriptionSubject, Record<string, boolean>> = {
			value: {},
			error: {},
			defaultValue: {},
			key: {},
			validated: {},
			valid: {},
			dirty: {},
		};
		const prev = context;
		const next = {
			...update,
			state: {
				...update.state,
				valid: createValidProxy(update.error),
				dirty: createDirtyProxy(update.metadata.defaultValue, update.value),
			},
		};

		// Apply change before notifying subscribers
		context = next;

		for (const subscriber of subscribers) {
			const subject = subscriber.getSubject?.();

			if (
				!subject ||
				(subject.error &&
					shouldNotify({
						prev: prev.error,
						next: next.error,
						compareFn: (prev, next) =>
							getValidationMessage(prev) !== getValidationMessage(next),
						cache: diff.error,
						scope: subject.error,
					})) ||
				(subject.defaultValue &&
					shouldNotify({
						prev: prev.metadata.defaultValue,
						next: next.metadata.defaultValue,
						compareFn: (prev, next) => prev !== next,
						cache: diff.defaultValue,
						scope: subject.defaultValue,
					})) ||
				(subject.key &&
					shouldNotify({
						prev: prev.state.key,
						next: next.state.key,
						compareFn: (prev, next) =>
							getValidationMessage(prev) !== getValidationMessage(next),
						cache: diff.key,
						scope: subject.key,
					})) ||
				(subject.valid &&
					shouldNotify({
						prev: prev.state.valid,
						next: next.state.valid,
						compareFn: (prev, next) => prev !== next,
						cache: diff.valid,
						scope: subject.valid,
					})) ||
				(subject.dirty &&
					shouldNotify({
						prev: prev.state.dirty,
						next: next.state.dirty,
						compareFn: (prev, next) => prev !== next,
						cache: diff.dirty,
						scope: subject.dirty,
					})) ||
				(subject.value &&
					shouldNotify({
						prev: prev.value,
						next: next.value,
						compareFn: (prev, next) =>
							JSON.stringify(prev) !== JSON.stringify(next),
						cache: diff.value,
						scope: subject.value,
					})) ||
				(subject.validated &&
					shouldNotify({
						prev: prev.state.validated,
						next: next.state.validated,
						compareFn: (prev, next) => (prev ?? false) !== (next ?? false),
						cache: diff.validated,
						scope: subject.validated,
					}))
			) {
				subscriber.callback();
			}
		}
	}

	function submit(event: SubmitEvent) {
		const element = event.target as HTMLFormElement;
		const submitter = event.submitter as
			| HTMLButtonElement
			| HTMLInputElement
			| null;

		invariant(
			element === getFormElement(),
			`The submit event is dispatched by form#${element.id} instead of form#${formId}`,
		);

		const formData = getFormData(element, submitter);
		const result = {
			formData,
			action: getFormAction(event),
			encType: getFormEncType(event),
			method: getFormMethod(event),
		};

		if (typeof latestOptions?.onValidate !== 'undefined') {
			try {
				const submission = latestOptions.onValidate({
					form: element,
					formData,
					submitter,
				});

				if (!submission.ready) {
					const result = submission.reject();

					if (
						result.error &&
						Object.values(result.error).every(
							(messages) => !messages.includes('__VALIDATION_UNDEFINED__'),
						)
					) {
						report(result);
						event.preventDefault();
					}
				}

				return {
					...result,
					submission,
				};
			} catch (error) {
				// eslint-disable-next-line no-console
				console.warn('Client validation failed', error);
			}
		}

		return result;
	}

	function resolveTarget(event: Event) {
		const form = getFormElement();
		const element = event.target;

		if (
			!isFieldElement(element) ||
			element.form !== form ||
			element.name === ''
		) {
			return null;
		}

		return element;
	}

	function willValidate(
		element: FieldElement,
		eventName: 'onInput' | 'onBlur',
	): boolean {
		const { shouldValidate = 'onSubmit', shouldRevalidate = shouldValidate } =
			latestOptions;
		const validated = context.state.validated[element.name];

		return validated
			? shouldRevalidate === eventName
			: shouldValidate === eventName;
	}

	function input(event: Event) {
		const element = resolveTarget(event);

		if (!element || !element.form) {
			return;
		}

		if (event.defaultPrevented || !willValidate(element, 'onInput')) {
			const formData = new FormData(element.form);
			const result = resolve(formData);

			updateContext({
				...context,
				value: flatten(result.data),
			});
		} else {
			requestIntent(element.form, {
				value: validate.serialize(element.name),
				formNoValidate: true,
			});
		}
	}

	function blur(event: Event) {
		const element = resolveTarget(event);

		if (
			!element ||
			event.defaultPrevented ||
			!willValidate(element, 'onBlur')
		) {
			return;
		}

		requestIntent(element.form, {
			value: validate.serialize(element.name),
			formNoValidate: true,
		});
	}

	function reset(event: Event) {
		const element = getFormElement();

		if (
			event.type !== 'reset' ||
			event.target !== element ||
			event.defaultPrevented
		) {
			return;
		}

		const metadata = initializeMetadata(latestOptions);

		updateContext({
			metadata,
			initialValue: metadata.defaultValue,
			value: metadata.defaultValue,
			error: {},
			state: {
				validated: {},
				key: {},
				valid: {},
				dirty: {},
			},
		});
	}

	function report(result: SubmissionResult) {
		const formElement = getFormElement();

		if (typeof result.initialValue === 'undefined') {
			formElement.reset();
			return;
		}

		const value = flatten(result.initialValue);

		updateContext({
			...context,
			initialValue: value,
			value,
			error: result.error ?? {},
			state: {
				...context.state,
				key: result.state?.key ?? {},
				validated: result.state?.validated ?? {},
			},
		});

		for (const element of formElement.elements) {
			if (isFieldElement(element) && element.name !== '') {
				element.setCustomValidity(
					context.error[element.name]?.join(', ') ?? '',
				);
			}
		}

		if (result.status === 'failed') {
			// Update focus
			focusFirstInvalidField(formElement);
		}
	}

	function update(options: Omit<FormOptions<Type>, 'lastResult'>) {
		latestOptions = options;
	}

	function subscribe(
		callback: () => void,
		getSubject?: () => SubscriptionSubject | undefined,
	) {
		const subscriber = {
			callback,
			getSubject,
		};

		subscribers.push(subscriber);

		return () => {
			subscribers = subscribers.filter((current) => current !== subscriber);
		};
	}

	function getContext(): FormContext {
		return context;
	}

	return {
		id: formId,
		submit,
		reset,
		input,
		blur,
		report,
		update,
		subscribe,
		getContext,
	};
}
