import {
	type KeysOf,
	type KeyType,
	type Constraint,
	type FieldElement,
	type FieldName,
	type Primitive,
	type SubmissionContext,
	type SubmissionResult,
	type Submission,
	type DefaultValue,
	type Form as FormMetadata,
	flatten,
	requestIntent,
	isFieldElement,
	getPaths,
	formatPaths,
	createForm,
} from '@conform-to/dom';
import {
	type RefObject,
	type ReactNode,
	createContext,
	createElement,
	startTransition,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useLayoutEffect,
	useCallback,
	useContext,
} from 'react';
import { validate } from './intent.js';

export interface FormConfig {
	id: string;
	descriptionId: string;
	errorId: string;
	errors: string[];
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => any;
	noValidate: boolean;
}

export interface Form<Type> {
	id: string;
	context: FormMetadata;
	errors: string[];
	config: FormConfig;
	fields: Fieldset<Type>;
}

export type Fieldset<Type> = Type extends Array<any>
	? { [Key in keyof Type]: Field<Type[Key]> }
	: Type extends { [key in string]?: any }
	? { [Key in KeysOf<Type>]: Field<KeyType<Type, Key>> }
	: never;

export type FieldList<Item> = Array<Field<Item> & { key: string }>;

export interface Field<Type> {
	id: string;
	formId: string;
	errorId: string;
	descriptionId: string;
	name: FieldName<Type>;
	defaultValue: Type | string | undefined;
	constraint: Constraint;
	errors: string[];
}

const FormContext = createContext<Record<string, FormMetadata>>({});

export function useFormContext(
	formId: string,
	localContext?: FormMetadata,
): FormMetadata {
	const context = useContext(FormContext);
	const result = localContext ?? context[formId];

	if (!result) {
		throw new Error('Form context is not available');
	}

	return result;
}

export function FormProvider(props: {
	formId: string;
	context: FormMetadata;
	children: ReactNode;
}) {
	const context = useContext(FormContext);
	const value = useMemo(
		() => ({ ...context, [props.formId]: props.context }),
		[context, props.formId, props.context],
	);

	return createElement(FormContext.Provider, {
		value,
		children: props.children,
	});
}

export function useFormId(preferredId?: string) {
	const id = useId();

	return preferredId ?? id;
}

export function useNoValidate(defaultNoValidate = true): boolean {
	const [noValidate, setNoValidate] = useState(defaultNoValidate);

	useEffect(() => {
		setNoValidate(true);
	}, []);

	return noValidate;
}

export function FormState(props: {
	formId: string;
	context: FormMetadata;
}): React.ReactElement {
	const context = useFormContext(props.formId, props.context);

	return createElement(
		'fieldset',
		{ form: props.formId, hidden: true },
		createElement('input', {
			type: 'hidden',
			form: props.formId,
			name: '__state__',
			value: JSON.stringify(context.state),
		}),
	);
}

export function generateIds(formId: string, name?: string) {
	const id = name ? `${formId}-${name}` : formId;

	return {
		id,
		formId,
		errorId: `${id}-error`,
		descriptionId: `${id}-description`,
	};
}

export function getName(key: string | number, prefix?: string) {
	const paths = getPaths(prefix ?? '');
	const name = formatPaths([...paths, key]);

	return name;
}

export function getFieldConfig(
	formId: string,
	name: string,
	context: FormMetadata,
) {
	return {
		...generateIds(formId, name),
		context,
		name,
		defaultValue: context.initialValue[name],
		constraint: context.attributes.constraint[name] ?? {},
		errors: context.error[name] ?? [],
	};
}

export function useForm<
	Type extends Record<string, any> = Record<string, any>,
>(config: {
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
}): Form<Type> {
	const formId = useFormId(config.id);
	const initializeForm = () =>
		createForm(
			formId,
			{
				defaultValue: flatten(config.defaultValue ?? {}),
				constraint: config.constraint ?? {},
			},
			config.lastResult,
		);
	const [form, setForm] = useState(initializeForm);

	// If id changes, reinitialize the form immediately
	if (formId !== form.id) {
		setForm(initializeForm);
	}

	const [context, setContext] = useState(form.context);
	const noValidate = useNoValidate(config.defaultNoValidate);
	const configRef = useRef(config);
	const { errorId, descriptionId, errors } = useField<Type>({
		form: formId,
		name: '',
		context,
	});
	const fields = useFieldset<Type>({
		form: formId,
		context,
	});

	useEffect(
		() =>
			form.subscribe((context) => startTransition(() => setContext(context))),
		[form],
	);

	useEffect(() => {
		// Report only if the submission has changed
		if (
			config.lastResult &&
			config.lastResult !== configRef.current.lastResult
		) {
			form.update(config.lastResult);
		}
	}, [form, config.lastResult]);

	useEffect(() => {
		configRef.current = config;
	});

	useEffect(() => {
		const handleReset = (event: Event) =>
			form.reset(event, {
				defaultValue: flatten(configRef.current.defaultValue ?? {}),
				constraint: configRef.current.constraint ?? {},
			});
		const handleEvent = (event: Event) =>
			form.handleEvent(event, ({ type, form, element, validated }) => {
				const {
					shouldValidate = 'onSubmit',
					shouldRevalidate = shouldValidate,
				} = configRef.current;
				const eventName = `on${type.slice(0, 1).toUpperCase()}${type
					.slice(1)
					.toLowerCase()}`;

				if (
					validated
						? shouldRevalidate === eventName
						: shouldValidate === eventName
				) {
					requestIntent(form, validate({ name: element.name }));
				}
			});

		window.addEventListener('reset', handleReset);
		window.addEventListener('input', handleEvent);
		// blur event is not bubbling, so we need to use capture phase
		window.addEventListener('blur', handleEvent, true);

		return () => {
			window.removeEventListener('reset', handleReset);
			window.removeEventListener('input', handleEvent);
			// blur event is not bubbling, so we need to use capture phase
			window.removeEventListener('blur', handleEvent, true);
		};
	}, [form]);

	const onSubmit = useCallback(
		(event: React.FormEvent<HTMLFormElement>) => {
			const submitEvent = event.nativeEvent as SubmitEvent;
			const result = form.submit(submitEvent, {
				onValidate: configRef.current.onValidate,
			});

			if (submitEvent.defaultPrevented) {
				event.preventDefault();
			}

			return result;
		},
		[form],
	);

	return {
		id: formId,
		config: {
			id: formId,
			errorId,
			descriptionId,
			onSubmit,
			noValidate,
			errors,
		},
		context,
		errors,
		fields,
	};
}

export function useFieldset<Type>(config: {
	form: string;
	name?: FieldName<Type>;
	context?: FormMetadata;
}): Fieldset<Type> {
	const metadata = useFormContext(config.form, config.context);

	return new Proxy({} as any, {
		get(_target, prop) {
			const getField = (key: string | number) => {
				const name = getName(key, config.name);
				const field = getFieldConfig(config.form, name, metadata);

				return field;
			};

			// To support array destructuring
			if (prop === Symbol.iterator) {
				let index = 0;

				return () => ({
					next: () => ({ value: getField(index++), done: false }),
				});
			}

			const index = Number(prop);

			if (typeof prop === 'string') {
				return getField(Number.isNaN(index) ? prop : index);
			}

			return;
		},
	});
}

/**
 * Derives the default list keys based on the path
 */
function getDefaultListKeys(
	defaultValue: Record<string, Primitive | Primitive[]>,
	listName: string,
): string[] {
	let maxIndex = -1;

	for (const name of Object.keys(defaultValue)) {
		if (name.startsWith(listName)) {
			const [index] = getPaths(name.slice(listName.length));

			if (typeof index === 'number' && index > maxIndex) {
				maxIndex = index;
			}
		}
	}

	return Array(maxIndex + 1)
		.fill('')
		.map((_, index) => `${index}]`);
}

export function useFieldList<Item>(config: {
	form: string;
	name: FieldName<Item[]>;
	context?: FormMetadata;
}): FieldList<Item> {
	const metadata = useFormContext(config.form, config.context);
	const keys = useMemo(
		() =>
			metadata.state.listKeys[config.name] ??
			getDefaultListKeys(metadata.initialValue, config.name),
		[config.name, metadata.initialValue, metadata.state.listKeys],
	);

	return keys.map((key, index) => {
		const name = getName(index, config.name);
		const field = getFieldConfig(config.form, name, metadata);

		return {
			...field,
			key,
			defaultValue: field.defaultValue as Item | string | undefined,
		};
	});
}

export function useField<Type>(config: {
	form: string;
	name: FieldName<Type>;
	context?: FormMetadata;
}): Field<Type> {
	const metadata = useFormContext(config.form, config.context);
	const name = config.name;
	const field = getFieldConfig(config.form, name, metadata);

	return {
		...field,
		defaultValue: field.defaultValue as Type | string | undefined,
	};
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
