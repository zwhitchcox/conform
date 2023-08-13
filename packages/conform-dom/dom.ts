import type { FormControl, FieldElement, Submitter } from './types.js';

/**
 * A type guard to check if the provided element is a form control
 */
export function isFormControl(element: unknown): element is FormControl {
	return (
		element instanceof Element &&
		(element.tagName === 'INPUT' ||
			element.tagName === 'SELECT' ||
			element.tagName === 'TEXTAREA' ||
			element.tagName === 'BUTTON')
	);
}

/**
 * A type guard to check if the provided element is a field element, which
 * is a form control excluding submit, button and reset type.
 */
export function isFieldElement(element: unknown): element is FieldElement {
	return (
		isFormControl(element) &&
		element.type !== 'submit' &&
		element.type !== 'button' &&
		element.type !== 'reset'
	);
}

/**
 * Resolves the form action based on the submit event
 */
export function getFormAction(event: SubmitEvent): string {
	const form = event.target as HTMLFormElement;
	const submitter = event.submitter as Submitter | null;

	return (
		submitter?.getAttribute('formaction') ??
		form.getAttribute('action') ??
		`${location.pathname}${location.search}`
	);
}

/**
 * Resolves the form encoding type based on the submit event
 */
export function getFormEncType(
	event: SubmitEvent,
): 'application/x-www-form-urlencoded' | 'multipart/form-data' {
	const form = event.target as HTMLFormElement;
	const submitter = event.submitter as Submitter | null;
	const encType = submitter?.getAttribute('formenctype') ?? form.enctype;

	if (encType === 'multipart/form-data') {
		return encType;
	}

	return 'application/x-www-form-urlencoded';
}

/**
 * Resolves the form method based on the submit event
 */
export function getFormMethod(
	event: SubmitEvent,
): 'get' | 'post' | 'put' | 'patch' | 'delete' {
	const form = event.target as HTMLFormElement;
	const submitter = event.submitter as Submitter | null;
	const method =
		submitter?.getAttribute('formmethod') ?? form.getAttribute('method');

	switch (method) {
		case 'post':
		case 'put':
		case 'patch':
		case 'delete':
			return method;
	}

	return 'get';
}

/**
 * A function to create a submitter button element
 */
export function createSubmitter(config: {
	name: string;
	value: string;
	hidden?: boolean;
	formAction?: string;
	formEnctype?: ReturnType<typeof getFormEncType>;
	formMethod?: ReturnType<typeof getFormMethod>;
	formNoValidate?: boolean;
}): Submitter {
	const button = document.createElement('button');

	button.name = config.name;
	button.value = config.value;

	if (config.hidden) {
		button.hidden = true;
	}

	if (config.formAction) {
		button.formAction = config.formAction;
	}

	if (config.formEnctype) {
		button.formEnctype = config.formEnctype;
	}

	if (config.formMethod) {
		button.formMethod = config.formMethod;
	}

	if (config.formNoValidate) {
		button.formNoValidate = true;
	}

	return button;
}

/**
 * Trigger form submission with a submitter.
 */
export function requestSubmit(
	form: HTMLFormElement,
	submitter: Submitter | null,
): void {
	let shouldRemoveSubmitter = false;

	if (submitter && !submitter.isConnected) {
		shouldRemoveSubmitter = true;
		form.appendChild(submitter);
	}

	if (typeof form.requestSubmit === 'function') {
		form.requestSubmit(submitter);
	} else {
		const event = new SubmitEvent('submit', {
			bubbles: true,
			cancelable: true,
			submitter,
		});

		form.dispatchEvent(event);
	}

	if (submitter && shouldRemoveSubmitter) {
		form.removeChild(submitter);
	}
}

/**
 * Focus on the first invalid form control in the form
 */
export function focusFirstInvalidField(form: HTMLFormElement) {
	for (const element of form.elements) {
		if (isFieldElement(element) && !element.validity.valid) {
			element.focus();
			break;
		}
	}
}
