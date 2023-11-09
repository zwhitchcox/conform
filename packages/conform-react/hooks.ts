import {
	type KeysOf,
	type KeyType,
	type Constraint,
	type FieldElement,
	type FieldName,
	type Form,
	type FormContext,
	type SubmissionResult,
	type Submission,
	type SubscriptionSubject,
	type DefaultValue,
	createForm,
	isFieldElement,
	getPaths,
	isMatchingPaths,
	formatPaths,
} from '@conform-to/dom';
import {
	type RefObject,
	type ReactNode,
	type MutableRefObject,
	createContext,
	createElement,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useLayoutEffect,
	useCallback,
	useContext,
	useSyncExternalStore,
} from 'react';

export interface BaseConfig<Type> {
	id: string;
	errorId: string;
	descriptionId: string;
	defaultValue: DefaultValue<Type>;
	value: DefaultValue<Type>;
	error: string[];
	allError: Record<string, string[]>;
	allValid: boolean;
	valid: boolean;
	dirty: boolean;
}

export interface Options<Type> {
	formId: string;
	name?: FieldName<Type>;
	context?: Form;
}

export interface FormConfig<Type extends Record<string, any>>
	extends BaseConfig<Type> {
	context: Form<Type>;
	fields: FieldsetConfig<Type>;
	onSubmit: (
		event: React.FormEvent<HTMLFormElement>,
	) => ReturnType<Form<Type>['submit']>;
	onReset: (event: React.FormEvent<HTMLFormElement>) => void;
	noValidate: boolean;
}

export type FieldsetConfig<Type> = Type extends Array<any>
	? { [Key in keyof Type]: FieldConfig<Type[Key]> }
	: Type extends { [key in string]?: any }
	? { [Key in KeysOf<Type>]: FieldConfig<KeyType<Type, Key>> }
	: never;

export type FieldListConfig<Item> = Array<FieldConfig<Item>>;

export interface FieldConfig<Type> extends BaseConfig<Type> {
	key?: string;
	formId: string;
	name: FieldName<Type>;
	constraint: Constraint;
}

const FormContext = createContext<Record<string, Form>>({});

export function useFormContext(
	formId: string,
	localContext?: Form | undefined,
	subjectRef?: MutableRefObject<SubscriptionSubject>,
): FormContext {
	const registry = useContext(FormContext);
	const form = localContext ?? registry[formId];

	if (!form) {
		throw new Error('Form context is not available');
	}

	const subscribe = useCallback(
		(callback: () => void) =>
			form.subscribe(callback, () => subjectRef?.current),
		[form, subjectRef],
	);
	const context = useSyncExternalStore(
		subscribe,
		form.getContext,
		form.getContext,
	);

	return context;
}

export function ConformBoundary(props: { context: Form; children: ReactNode }) {
	const context = useContext(FormContext);
	const value = useMemo(
		() => ({ ...context, [props.context.id]: props.context }),
		[context, props.context],
	);

	return createElement(
		FormContext.Provider,
		{ value },
		createElement(
			'div',
			{
				onInput(event: React.ChangeEvent<HTMLDivElement>) {
					props.context.input(event.nativeEvent);
				},
				onBlur(event: React.FocusEvent<HTMLDivElement>) {
					props.context.blur(event.nativeEvent);
				},
			},
			createElement(FormStateInput, { formId: props.context.id }),
			props.children,
		),
	);
}

export function FormStateInput(props: {
	formId: string;
	context?: Form;
}): React.ReactElement {
	const subjectRef = useSubjectRef({
		validated: {
			parent: [''],
		},
		key: {
			parent: [''],
		},
	});
	const context = useFormContext(props.formId, props.context, subjectRef);

	return createElement('input', {
		type: 'hidden',
		form: props.formId,
		name: '__state__',
		value: JSON.stringify({
			key: context.state.key,
			validated: context.state.validated,
		}),
	});
}

export function useFormId(preferredId?: string) {
	const id = useId();

	return preferredId ?? id;
}

export function useNoValidate(defaultNoValidate = true): boolean {
	const [noValidate, setNoValidate] = useState(defaultNoValidate);

	useEffect(() => {
		// This is necessary to fix an issue in strict mode with related to our proxy setup
		// It avoids the component from being rerendered without re-rendering the child
		// Which reset the proxy but failed to capture its usage within child component
		if (!noValidate) {
			setNoValidate(true);
		}
	}, [noValidate]);

	return noValidate;
}

export function getName(key: string | number, prefix?: string) {
	const paths = getPaths(prefix ?? '');
	const name = formatPaths([...paths, key]);

	return name;
}

export function getFieldConfig<Type>(
	formId: string,
	context: FormContext,
	options: {
		name?: string;
		defaultKey?: string;
		subjectRef: MutableRefObject<SubscriptionSubject>;
	},
): FieldConfig<Type> {
	const name = options.name ?? '';
	const id = name ? `${formId}-${name}` : formId;
	const error = context.error[name] ?? [];
	const updateSubject = (
		key: keyof SubscriptionSubject,
		type: 'parent' | 'name',
	) => {
		options.subjectRef.current[key] = {
			...options.subjectRef.current[key],
			[type]: (options.subjectRef.current[key]?.[type] ?? []).concat(name),
		};
	};

	return new Proxy(
		{
			key: context.state.key[name] ?? options.defaultKey,
			id,
			formId,
			errorId: `${id}-error`,
			descriptionId: `${id}-description`,
			name,
			defaultValue: context.initialValue[name] as DefaultValue<Type>,
			value: context.value[name] as DefaultValue<Type>,
			constraint: context.metadata.constraint[name] ?? {},
			get valid() {
				return context.state.valid[name] ?? false;
			},
			get dirty() {
				return context.state.dirty[name] ?? false;
			},
			get allValid() {
				const keys = Object.keys(context.error);

				if (name === '') {
					return keys.length === 0;
				}

				for (const key of Object.keys(context.error)) {
					if (isMatchingPaths(key, name) && !context.state.valid[key]) {
						return false;
					}
				}

				return true;
			},
			get allError() {
				if (name === '') {
					return context.error;
				}

				const result: Record<string, string[]> = {};

				for (const [key, errors] of Object.entries(context.error)) {
					if (isMatchingPaths(key, name)) {
						result[key] = errors;
					}
				}

				return result;
			},
			error,
		},
		{
			get(target, key, receiver) {
				switch (key) {
					case 'key':
					case 'error':
					case 'defaultValue':
					case 'value':
					case 'valid':
					case 'dirty':
						updateSubject(key, 'name');
						break;
					case 'allError':
						updateSubject('error', 'parent');
						break;
					case 'allValid':
						updateSubject('valid', 'parent');
						break;
				}

				return Reflect.get(target, key, receiver);
			},
		},
	);
}

export function useForm<Type extends Record<string, any>>(options: {
	id?: string;
	defaultValue?: DefaultValue<Type>;
	lastResult?: SubmissionResult;
	constraint?: Record<string, Constraint>;
	defaultNoValidate?: boolean;
	shouldValidate?: 'onSubmit' | 'onBlur' | 'onInput';
	shouldRevalidate?: 'onSubmit' | 'onBlur' | 'onInput';
	onValidate?: ({
		form,
		submitter,
		formData,
	}: {
		form: HTMLFormElement;
		submitter: HTMLInputElement | HTMLButtonElement | null;
		formData: FormData;
	}) => Submission<any>;
}): FormConfig<Type> {
	const formId = useFormId(options.id);
	const initializeForm = () =>
		createForm(formId, {
			defaultValue: options.defaultValue,
			constraint: options.constraint,
			lastResult: options.lastResult,
			onValidate: options.onValidate,
			shouldValidate: options.shouldValidate,
			shouldRevalidate: options.shouldRevalidate,
		});
	const [form, setForm] = useState(initializeForm);

	// If id changes, reinitialize the form immediately
	if (formId !== form.id) {
		setForm(initializeForm);
	}

	const noValidate = useNoValidate(options.defaultNoValidate);
	const optionsRef = useRef(options);
	const config = useField<Type>({
		formId,
		context: form,
		name: '',
	});
	const fields = useFieldset<Type>({
		formId,
		context: form,
	});

	useEffect(() => {
		if (options.lastResult === optionsRef.current.lastResult) {
			// If there is no change, do nothing
			return;
		}

		if (options.lastResult) {
			form.report(options.lastResult);
		} else {
			document.forms.namedItem(form.id)?.reset();
		}
	}, [form, options.lastResult]);

	useEffect(() => {
		optionsRef.current = options;
		form.update({
			defaultValue: options.defaultValue,
			constraint: options.constraint,
			shouldValidate: options.shouldValidate,
			shouldRevalidate: options.shouldRevalidate,
			onValidate: options.onValidate,
		});
	});

	const onSubmit = useCallback(
		(event: React.FormEvent<HTMLFormElement>) => {
			const submitEvent = event.nativeEvent as SubmitEvent;
			const result = form.submit(submitEvent);

			if (submitEvent.defaultPrevented) {
				event.preventDefault();
			}

			return result;
		},
		[form],
	);
	const onReset = useCallback(
		(event: React.FormEvent<HTMLFormElement>) => form.reset(event.nativeEvent),
		[form],
	);

	return {
		context: form,
		id: formId,
		errorId: config.errorId,
		descriptionId: config.descriptionId,
		fields,
		onSubmit,
		onReset,
		noValidate,
		get defaultValue() {
			return config.defaultValue;
		},
		get value() {
			return config.value;
		},
		get dirty() {
			return config.dirty;
		},
		get valid() {
			return config.valid;
		},
		get error() {
			return config.error;
		},
		get allError() {
			return config.allError;
		},
		get allValid() {
			return config.allValid;
		},
	};
}

export function useFieldset<Type>(
	options: Options<Type>,
): FieldsetConfig<Type> {
	const subjectRef = useSubjectRef();
	const context = useFormContext(options.formId, options.context, subjectRef);

	return new Proxy({} as any, {
		get(target, prop, receiver) {
			const getConfig = (key: string | number) => {
				const name = getName(key, options.name);
				const config = getFieldConfig(options.formId, context, {
					name,
					subjectRef,
				});

				return config;
			};

			// To support array destructuring
			if (prop === Symbol.iterator) {
				let index = 0;

				return () => ({
					next: () => ({ value: getConfig(index++), done: false }),
				});
			}

			const index = Number(prop);

			if (typeof prop === 'string') {
				return getConfig(Number.isNaN(index) ? prop : index);
			}

			return Reflect.get(target, prop, receiver);
		},
	});
}

export interface FieldListOptions<Item> extends Omit<Options<Item[]>, 'name'> {
	name: Required<Options<Item[]>>['name'];
}

export function useFieldList<Item>(
	options: FieldListOptions<Item>,
): FieldListConfig<Item> {
	const subjectRef = useSubjectRef({
		defaultValue: {
			name: [options.name],
		},
	});
	const context = useFormContext(options.formId, options.context, subjectRef);
	const defaultValue = context.initialValue[options.name] ?? [];

	if (!Array.isArray(defaultValue)) {
		throw new Error('The default value at the given name is not a list');
	}

	return Array(defaultValue.length)
		.fill(0)
		.map((_, index) => {
			const name = getName(index, options.name);
			const config = getFieldConfig<Item>(options.formId, context, {
				name,
				defaultKey: `${index}`,
				subjectRef,
			});

			return config;
		});
}

export function useSubjectRef(
	initialSubject: SubscriptionSubject = {},
): MutableRefObject<SubscriptionSubject> {
	const subjectRef = useRef(initialSubject);

	// Reset the subject everytime the component is rerendered
	// This let us subscribe to data used in the last render only
	subjectRef.current = initialSubject;

	return subjectRef;
}

export function useField<Type>(options: Options<Type>): FieldConfig<Type> {
	const subjectRef = useSubjectRef();
	const context = useFormContext(options.formId, options.context, subjectRef);
	const field = getFieldConfig<Type>(options.formId, context, {
		name: options.name,
		subjectRef,
	});

	return field;
}

/**
 * useLayoutEffect is client-only.
 * This basically makes it a no-op on server
 */
const useSafeLayoutEffect =
	typeof document === 'undefined' ? useEffect : useLayoutEffect;

interface InputControl {
	change: (
		eventOrValue: { target: { value: string } } | string | boolean,
	) => void;
	focus: () => void;
	blur: () => void;
}

/**
 * Returns a ref object and a set of helpers that dispatch corresponding dom event.
 *
 * @see https://conform.guide/api/react#useinputevent
 */
export function useInputEvent(options: {
	ref:
		| RefObject<FieldElement>
		| (() => Element | RadioNodeList | FieldElement | null | undefined);
	onInput?: (event: Event) => void;
	onFocus?: (event: FocusEvent) => void;
	onBlur?: (event: FocusEvent) => void;
	onReset?: (event: Event) => void;
}): InputControl {
	const optionsRef = useRef(options);
	const eventDispatched = useRef({
		onInput: false,
		onFocus: false,
		onBlur: false,
	});

	useSafeLayoutEffect(() => {
		optionsRef.current = options;
	});

	useSafeLayoutEffect(() => {
		const createEventListener = (
			listener: Exclude<keyof typeof options, 'ref'>,
		) => {
			return (event: any) => {
				const element =
					typeof optionsRef.current?.ref === 'function'
						? optionsRef.current?.ref()
						: optionsRef.current?.ref.current;

				if (
					isFieldElement(element) &&
					(listener === 'onReset'
						? event.target === element.form
						: event.target === element)
				) {
					if (listener !== 'onReset') {
						eventDispatched.current[listener] = true;
					}

					optionsRef.current?.[listener]?.(event);
				}
			};
		};
		const inputHandler = createEventListener('onInput');
		const focusHandler = createEventListener('onFocus');
		const blurHandler = createEventListener('onBlur');
		const resetHandler = createEventListener('onReset');

		// focus/blur event does not bubble
		document.addEventListener('input', inputHandler, true);
		document.addEventListener('focus', focusHandler, true);
		document.addEventListener('blur', blurHandler, true);
		document.addEventListener('reset', resetHandler);

		return () => {
			document.removeEventListener('input', inputHandler, true);
			document.removeEventListener('focus', focusHandler, true);
			document.removeEventListener('blur', blurHandler, true);
			document.removeEventListener('reset', resetHandler);
		};
	}, []);

	const control = useMemo<InputControl>(() => {
		const dispatch = (
			listener: Exclude<keyof typeof options, 'ref' | 'onReset'>,
			fn: (element: FieldElement) => void,
		) => {
			if (!eventDispatched.current[listener]) {
				const element =
					typeof optionsRef.current?.ref === 'function'
						? optionsRef.current?.ref()
						: optionsRef.current?.ref.current;

				if (!isFieldElement(element)) {
					// eslint-disable-next-line no-console
					console.warn('Failed to dispatch event; is the input mounted?');
					return;
				}

				// To avoid recursion
				eventDispatched.current[listener] = true;
				fn(element);
			}

			eventDispatched.current[listener] = false;
		};

		return {
			change(eventOrValue) {
				dispatch('onInput', (element) => {
					if (
						element instanceof HTMLInputElement &&
						(element.type === 'checkbox' || element.type === 'radio')
					) {
						if (typeof eventOrValue !== 'boolean') {
							throw new Error(
								'You should pass a boolean when changing a checkbox or radio input',
							);
						}

						element.checked = eventOrValue;
					} else {
						if (typeof eventOrValue === 'boolean') {
							throw new Error(
								'You can pass a boolean only when changing a checkbox or radio input',
							);
						}

						const value =
							typeof eventOrValue === 'string'
								? eventOrValue
								: eventOrValue.target.value;

						// No change event will triggered on React if `element.value` is updated
						// before dispatching the event
						if (element.value !== value) {
							/**
							 * Triggering react custom change event
							 * Solution based on dom-testing-library
							 * @see https://github.com/facebook/react/issues/10135#issuecomment-401496776
							 * @see https://github.com/testing-library/dom-testing-library/blob/main/src/events.js#L104-L123
							 */
							const { set: valueSetter } =
								Object.getOwnPropertyDescriptor(element, 'value') || {};
							const prototype = Object.getPrototypeOf(element);
							const { set: prototypeValueSetter } =
								Object.getOwnPropertyDescriptor(prototype, 'value') || {};

							if (
								prototypeValueSetter &&
								valueSetter !== prototypeValueSetter
							) {
								prototypeValueSetter.call(element, value);
							} else {
								if (valueSetter) {
									valueSetter.call(element, value);
								} else {
									throw new Error(
										'The given element does not have a value setter',
									);
								}
							}
						}
					}

					// Dispatch input event with the updated input value
					element.dispatchEvent(new InputEvent('input', { bubbles: true }));
					// Dispatch change event (necessary for select to update the selected option)
					element.dispatchEvent(new Event('change', { bubbles: true }));
				});
			},
			focus() {
				dispatch('onFocus', (element) => {
					element.dispatchEvent(
						new FocusEvent('focusin', {
							bubbles: true,
						}),
					);
					element.dispatchEvent(new FocusEvent('focus'));
				});
			},
			blur() {
				dispatch('onBlur', (element) => {
					element.dispatchEvent(
						new FocusEvent('focusout', {
							bubbles: true,
						}),
					);
					element.dispatchEvent(new FocusEvent('blur'));
				});
			},
		};
	}, [optionsRef]);

	return control;
}
