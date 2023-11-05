import {
	type KeysOf,
	type KeyType,
	type Constraint,
	type FieldElement,
	type FieldName,
	type Form,
	type FormContext,
	type SubmissionContext,
	type SubmissionResult,
	type Submission,
	type SubscriptionSubject,
	type DefaultValue,
	createForm,
	isFieldElement,
	getPaths,
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

export interface BaseConfig {
	id: string;
	errorId: string;
	descriptionId: string;
	valid: boolean;
	dirty: boolean;
}

export interface Options<Type> {
	formId: string;
	name?: FieldName<Type>;
	context?: Form;
}

export interface FormConfig extends BaseConfig {
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => any;
	onReset: (event: React.FormEvent<HTMLFormElement>) => void;
	noValidate: boolean;
}

export interface FormResult<Type extends Record<string, unknown>> {
	context: Form<Type>;
	errors: string[];
	fieldErrors: Record<string, string[]>;
	config: FormConfig;
	fields: FieldsetConfig<Type>;
}

export type FieldsetConfig<Type> = Type extends Array<any>
	? { [Key in keyof Type]: FieldConfig<Type[Key]> }
	: Type extends { [key in string]?: any }
	? { [Key in KeysOf<Type>]: FieldConfig<KeyType<Type, Key>> }
	: never;

export type FieldListConfig<Item> = Array<FieldConfig<Item>>;

export interface FieldConfig<Type> extends BaseConfig {
	key?: string;
	formId: string;
	name: FieldName<Type>;
	defaultValue: DefaultValue<Type>;
	value: DefaultValue<Type>;
	constraint: Constraint;
	errors: string[];
	fieldErrors: Record<string, string[]>;
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
		key?: string;
		subjectRef: MutableRefObject<SubscriptionSubject>;
	},
): FieldConfig<Type> {
	const name = options.name ?? '';
	const id = name ? `${formId}-${name}` : formId;
	const errors = context.error[name] ?? [];

	return new Proxy(
		{
			key: options.key,
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
			get fieldErrors() {
				if (name === '') {
					return context.error;
				}

				const result: Record<string, string[]> = {};

				for (const [key, errors] of Object.entries(context.error)) {
					if (
						key === name ||
						key.startsWith(`${name}.`) ||
						key.startsWith(`${name}[`)
					) {
						result[key] = errors;
					}
				}

				return result;
			},
			errors,
		},
		{
			get(target, key, receiver) {
				switch (key) {
					case 'errors':
						options.subjectRef.current.error = {
							...options.subjectRef.current.error,
							name: (options.subjectRef.current.error?.name ?? []).concat(name),
						};
						break;
					case 'fieldErrors':
						options.subjectRef.current.error = {
							...options.subjectRef.current.error,
							parent: (options.subjectRef.current.error?.parent ?? []).concat(
								name,
							),
						};
						break;
					case 'defaultValue':
					case 'value':
					case 'valid':
					case 'dirty':
						options.subjectRef.current[key] = {
							...options.subjectRef.current[key],
							name: (options.subjectRef.current[key]?.name ?? []).concat(name),
						};
						break;
				}

				return Reflect.get(target, key, receiver);
			},
		},
	);
}

export function useForm<
	Type extends Record<string, any> = Record<string, any>,
>(options: {
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
	}: SubmissionContext) => Submission<any>;
}): FormResult<Type> {
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
		config: {
			id: formId,
			errorId: config.errorId,
			descriptionId: config.descriptionId,
			onSubmit,
			onReset,
			noValidate,
			get dirty() {
				return config.dirty;
			},
			get valid() {
				return config.valid;
			},
		},
		context: form,
		get errors() {
			return config.errors;
		},
		get fieldErrors() {
			return config.fieldErrors;
		},
		fields,
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
		key: {
			name: [options.name],
		},
	});
	const context = useFormContext(options.formId, options.context, subjectRef);
	const keys = useMemo(() => {
		let keys = context.state.key[options.name];

		if (!keys) {
			const list = context.metadata.defaultValue[options.name] ?? [];

			if (!Array.isArray(list)) {
				throw new Error('The default value at the given name is not a list');
			}

			keys = Array(list.length)
				.fill('')
				.map((_, index) => `${index}`);
		}

		return keys;
	}, [options.name, context]);

	return keys.map((key, index) => {
		const name = getName(index, options.name);
		const config = getFieldConfig<Item>(options.formId, context, {
			name,
			key,
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
