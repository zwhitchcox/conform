import { getFormData } from './formdata.js';
import {
	isFieldElement,
	getFormAction,
	getFormEncType,
	getFormMethod,
	focusFirstInvalidField,
} from './dom.js';
import type {
	FormMetadata,
	FieldElement,
	Submission,
	SubmissionContext,
	SubmissionResult,
} from './types.js';
import { invariant } from './util.js';

export type Form = ReturnType<typeof createForm>;

export function createForm(
	formId: string,
	metadata: FormMetadata,
	lastResult?: SubmissionResult,
) {
	let listeners: Array<(context: any) => void> = [];
	let context = {
		metadata,
		initialValue: lastResult?.initialValue ?? metadata.defaultValue,
		error: lastResult?.error ?? {},
		state: lastResult?.state ?? {
			validated: {},
			listKeys: {},
		},
	};

	function getFormElement(formId: string) {
		const element = document.forms.namedItem(formId);
		invariant(element !== null, `Form#${formId} does not exist`);
		return element;
	}

	function updateContext(update: any) {
		context = update;

		for (const callback of listeners) {
			callback(context);
		}
	}

	return {
		id: formId,
		context,
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
								(messages) => !messages.includes('__VALIDATION_UNDEFINED__'),
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
			const formElement = getFormElement(formId);

			if (typeof result.initialValue === 'undefined') {
				formElement.reset();
				return;
			}

			updateContext({
				...context,
				initialValue: result.initialValue,
				error: result.error ?? {},
				state: result.state ?? {
					validated: {},
					listKeys: {},
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
				validated: context.state.validated?.[element.name] ?? false,
			});
		},
		reset(event: Event, newMetadata?: FormMetadata) {
			const element = getFormElement(formId);

			if (
				event.type !== 'reset' ||
				event.target !== element ||
				event.defaultPrevented
			) {
				return;
			}

			const metadata = newMetadata ?? context.metadata;

			updateContext({
				metadata,
				initialValue: metadata.defaultValue,
				error: {},
				state: {
					validated: {},
					listKeys: {},
				},
			});
		},
		subscribe(callback: (context: any) => void) {
			listeners.push(callback);

			return () => {
				listeners = listeners.filter((listener) => listener !== callback);
			};
		},
	};
}
