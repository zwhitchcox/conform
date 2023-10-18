import { getFormData } from './formdata.js';
import {
	isFieldElement,
	getFormAction,
	getFormEncType,
	getFormMethod,
	focusFirstInvalidField,
} from './dom.js';
import type {
	Entry,
	FormAttributes,
	FieldElement,
	Submission,
	SubmissionContext,
	SubmissionResult,
	Update,
} from './types.js';
import { invariant } from './util.js';

export type Registry = ReturnType<typeof createRegistry>;

export function createRegistry() {
	const store = new Map<string, Entry>();

	function getEntry(formId: string) {
		const entry = store.get(formId);
		invariant(typeof entry !== 'undefined', `Form#${formId} does not exist`);
		return entry;
	}

	function getFormElement(formId: string) {
		const element = document.forms.namedItem(formId);
		invariant(element !== null, `Form#${formId} does not exist`);
		return element;
	}

	return {
		register(
			formId: string,
			attributes: FormAttributes,
			lastResult?: SubmissionResult,
		) {
			store.set(formId, {
				form: {
					attributes,
					initialValue: lastResult?.initialValue ?? attributes.defaultValue,
					error: lastResult?.error ?? {},
					state: lastResult?.state ?? {
						validated: {},
						listKeys: {},
					},
				},
				subscribers: [],
			});

			return {
				id: formId,
				initialize() {
					// Mark the form as initialized
					// Update default value

					return () => {
						// Mark the form as uninitialized
					};
				},
				submit<Type>(
					event: SubmitEvent,
					config?: {
						onValidate?: (context: SubmissionContext) => Submission<Type>;
					},
				): {
					formData: FormData;
					action: ReturnType<typeof getFormAction>;
					encType: ReturnType<typeof getFormEncType>;
					method: ReturnType<typeof getFormMethod>;
					submission?: Submission<Type>;
				} {
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

							if (!submission.ready) {
								const result = submission.reject();

								if (
									result.error &&
									Object.values(result.error).every(
										(messages) =>
											!messages.includes('__VALIDATION_UNDEFINED__'),
									)
								) {
									this.update(result);
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
				},
				update(result: SubmissionResult) {
					const entry = getEntry(formId);
					const formElement = getFormElement(formId);

					if (typeof result.initialValue === 'undefined') {
						formElement.reset();
						return;
					}

					const updates: Array<Update> = [];
					const delimiter = String.fromCharCode(31);

					for (const name of Object.keys({
						...entry.form.error,
						...result.error,
					})) {
						const prev = entry.form.error[name] ?? [];
						const next = result.error?.[name] ?? [];

						if (
							!next.includes('__VALIDATION_SKIPPED__') &&
							next.join(delimiter) !== prev.join(delimiter)
						) {
							updates.push({ type: 'error', name, prev, next });
						}
					}

					for (const [name, value] of Object.entries(
						result.state?.validated ?? {},
					)) {
						const prev = entry.form.state.validated[name];
						const next = value;

						if (next !== Boolean(prev)) {
							updates.push({ type: 'validated', name, prev, next });
						}
					}

					for (const [name, value] of Object.entries(
						result.state?.listKeys ?? {},
					)) {
						const prev = entry.form.state.listKeys[name];
						const next = value;

						if (JSON.stringify(next) !== JSON.stringify(prev)) {
							updates.push({ type: 'list', name, prev, next });
						}
					}

					store.set(formId, {
						...entry,
						form: {
							...entry.form,
							initialValue: result.initialValue,
							error: result.error ?? {},
							state: result.state ?? {
								validated: {},
								listKeys: {},
							},
						},
					});

					if (updates.length > 0) {
						const subscribers = new Set(entry.subscribers);

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
					}

					if (result.status === 'failed') {
						// Update focus
						focusFirstInvalidField(formElement);
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
					const entry = getEntry(formId);
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
						validated: entry.form.state.validated?.[element.name] ?? false,
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

					const entry = getEntry(formId);
					const attributes = updatedAttributes ?? entry.form.attributes;

					store.set(formId, {
						form: {
							attributes,
							initialValue: attributes.defaultValue,
							error: {},
							state: {
								validated: {},
								listKeys: {},
							},
						},
						subscribers: entry.subscribers,
					});

					// Notify all subscribers
					for (const { callback } of entry.subscribers) {
						callback();
					}
				},
			};
		},
		getForm(formId: string) {
			return getEntry(formId).form;
		},
		subscribe(
			formId: string,
			callback: () => void,
			shouldNotify = (update: Update) => true,
		) {
			const entry = getEntry(formId);
			const subscripition = {
				shouldNotify,
				callback,
			};

			store.set(formId, {
				...entry,
				subscribers: [...entry.subscribers, subscripition],
			});

			return () => {
				const entry = getEntry(formId);

				store.set(formId, {
					...entry,
					subscribers: entry.subscribers.filter((sub) => sub !== subscripition),
				});
			};
		},
	};
}
