import { getFormData } from '../formdata.js';
import {
	type FormControl as FieldElement,
	isFormControl as isFieldElement,
	getFormAction,
	getFormEncType,
	getFormMethod,
	focusFirstInvalidControl,
} from '../dom.js';
import { VALIDATION_SKIPPED } from '../parse.js';
import { type Submission, type SubmissionResult } from './parse.js';
import { invariant } from './util.js';

export type Form = {
	attributes: FormAttributes;
	initialValue: Record<string, unknown>;
	error: Record<string, string[]>;
	state: FormState;
	subscribers: Array<{
		shouldNotify: (update: Update) => boolean;
		callback: () => void;
	}>;
};

export type Constraint = {
	required?: boolean;
	minLength?: number;
	maxLength?: number;
	min?: string | number;
	max?: string | number;
	step?: string | number;
	multiple?: boolean;
	pattern?: string;
};

export type FormAttributes = {
	defaultValue: Record<string, unknown>;
	constraint: Record<string, Constraint>;
};

export type FormState = {
	validated: Record<string, boolean>;
	list: Record<string, Array<string>>;
};

export type SubmissionContext = {
	form: HTMLFormElement;
	submitter: HTMLInputElement | HTMLButtonElement | null;
	formData: FormData;
};

export type Registry = ReturnType<typeof createRegistry>;

type Update =
	| {
			type: 'error';
			name: string;
			prev?: string[];
			next: string[];
	  }
	| {
			type: 'list';
			name: string;
			prev?: Array<string>;
			next: Array<string>;
	  }
	| {
			type: 'validated';
			name: string;
			prev?: boolean;
			next: boolean;
	  };

// FIXME: this is probably not working as expected
function shouldPreventDefault(submission: Submission<unknown>): boolean {
	if (submission.state === 'accepted') {
		return false;
	}

	const result = submission.report();

	for (const messages of Object.values(result.error)) {
		for (const message of messages) {
			if (message.startsWith('[VALIDATION_UNDEFINED] ')) {
				return false;
			}
		}
	}

	return true;
}

export function createRegistry(
	config: {
		onUpdate?: (type: 'add' | 'remove', formId: string) => void;
	} = {},
) {
	const store = new Map<string, Form>();

	function getForm(formId: string) {
		const state = store.get(formId);
		invariant(typeof state !== 'undefined', `Form#${formId} does not exist`);
		return state;
	}

	function getFormElement(formId: string) {
		const element = document.forms.namedItem(formId);
		invariant(element !== null, `Form#${formId} does not exist`);
		return element;
	}

	return {
		add(
			formId: string,
			attributes: FormAttributes,
			lastResult?: SubmissionResult,
		) {
			if (store.has(formId)) {
				throw new Error(`Form#${formId} already exists`);
			}

			store.set(formId, {
				attributes,
				initialValue: lastResult?.payload ?? attributes.defaultValue,
				error: lastResult?.error ?? {},
				state: lastResult?.state ?? {
					validated: {},
					list: {},
				},
				subscribers: [],
			});

			console.log(`#${formId}`, 'initialized', store.get(formId));

			config.onUpdate?.('add', formId);

			return {
				id: formId,
				submit(
					event: SubmitEvent,
					config?: {
						onValidate?: (context: SubmissionContext) => Submission<unknown>;
					},
				) {
					const element = event.target as HTMLFormElement;
					const submitter = event.submitter as
						| HTMLButtonElement
						| HTMLInputElement
						| null;

					invariant(
						element === getFormElement(formId),
						`Form#${formId} does not exist`,
					);

					const formData = getFormData(element, submitter);
					const result = {
						formData,
						action: getFormAction(event),
						encType: getFormEncType(event),
						method: getFormMethod(event),
					};

					if (typeof config?.onValidate !== 'undefined') {
						try {
							const submission = config.onValidate({
								form: element,
								formData,
								submitter,
							});

							if (
								// !submitter?.formNoValidate &&
								shouldPreventDefault(submission)
							) {
								const result = submission.report();

								this.update(result);
								event.preventDefault();
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
				},
				update(result: SubmissionResult) {
					const form = getForm(formId);
					const formElement = getFormElement(formId);

					if (result.payload === null) {
						formElement.reset();
						return;
					}

					const updates: Array<Update> = [];
					const delimiter = String.fromCharCode(31);
					const skippedPrefix = '[VALIDATION_SKIPPED] ';

					for (const name of Object.keys({ ...form.error, ...result.error })) {
						const prev = form.error[name] ?? [];
						const next = (result.error[name] ?? []).map(message => {
							if (message.startsWith(skippedPrefix)) {
								const actualMessage = message.slice(skippedPrefix.length);

								if (prev.includes(actualMessage)) {
									return actualMessage;
								}
							}

							return message;
						});

						if (next.join(delimiter) !== prev.join(delimiter)) {
							updates.push({ type: 'error', name, prev, next });
						}
					}

					for (const [name, value] of Object.entries(result.state.validated)) {
						const prev = form.state.validated[name];
						const next = value;

						if (next !== Boolean(prev)) {
							updates.push({ type: 'validated', name, prev, next });
						}
					}

					for (const [name, value] of Object.entries(result.state.list)) {
						const prev = form.state.list[name];
						const next = value;

						if (JSON.stringify(next) !== JSON.stringify(prev)) {
							updates.push({ type: 'list', name, prev, next });
						}
					}

					if (updates.length === 0) {
						return;
					}

					store.set(formId, {
						...form,
						initialValue: Object.entries(form.initialValue).reduce(
							(defaultValue, [name, value]) => {
								if (
									typeof defaultValue[name] === 'undefined' &&
									!result.update?.remove?.some((prefix) =>
										name.startsWith(prefix),
									)
								) {
									defaultValue[name] = value;
								}

								return defaultValue;
							},
							result.update?.override ?? {},
						),
						error: result.error,
						state: result.state,
					});

					console.log(`#${formId}`, 'updated', store.get(formId));

					const subscribers = new Set(form.subscribers);

					for (const update of updates) {
						const element = formElement.elements.namedItem(update.name);

						// Set custom validity only if the element has a name
						if (
							isFieldElement(element) &&
							element.name &&
							update.type === 'error'
						) {
							element.setCustomValidity(update.next.join(', '));
						}

						for (const subscriber of subscribers) {
							if (subscriber.shouldNotify(update)) {
								// Notify subscribers
								subscriber.callback();

								// Notified subscribers are removed from the set
								subscribers.delete(subscriber);
							}
						}
					}

					if (result.update?.focusField ?? true) {
						// Update focus
						focusFirstInvalidControl(formElement);
					}
				},
				handleEvent(
					event: Event,
					handler: (data: {
						type: string;
						form: HTMLFormElement;
						element: FieldElement;
						validated: boolean;
					}) => void,
				) {
					const form = getForm(formId);
					const formElement = getFormElement(formId);
					const element = event.target;

					if (
						!isFieldElement(element) ||
						element.form !== formElement ||
						element.name === '' ||
						event.defaultPrevented
					) {
						return;
					}

					handler({
						type: event.type,
						form: formElement,
						element,
						validated: form.state.validated?.[element.name] ?? false,
					});
				},
				reset(event: Event, updatedAttributes?: FormAttributes) {
					const element = getFormElement(formId);

					if (
						event.type !== 'reset' ||
						event.target !== element ||
						event.defaultPrevented
					) {
						return;
					}

					const form = getForm(formId);
					const attributes = updatedAttributes ?? form.attributes;

					store.set(formId, {
						attributes,
						initialValue: attributes.defaultValue,
						error: {},
						state: {
							validated: {},
							list: {},
						},
						subscribers: form.subscribers,
					});

					console.log(`#${formId}`, 'reset', store.get(formId));

					// Notify all subscribers
					for (const { callback } of form.subscribers) {
						callback();
					}
				},
			};
		},
		remove(formId: string) {
			config.onUpdate?.('remove', formId);

			if (!store.delete(formId)) {
				// eslint-disable-next-line no-console
				console.warn(`Form#${formId} does not exist`);
			}
		},
		getForm(formId: string) {
			return getForm(formId);
		},
		subscribe(
			formId: string,
			callback: () => void,
			shouldNotify = (update: Update) => true,
		) {
			const form = getForm(formId);
			const subscripition = {
				shouldNotify,
				callback,
			};

			store.set(formId, {
				...form,
				subscribers: [...form.subscribers, subscripition],
			});

			return () => {
				const form = getForm(formId);

				store.set(formId, {
					...form,
					subscribers: form.subscribers.filter((sub) => sub !== subscripition),
				});
			};
		},
	};
}
