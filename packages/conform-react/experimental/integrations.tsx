import {
	type KeysOf,
	type KeyType,
	type Constraint,
	type Registry,
	type SubmissionContext,
	type SubmissionResult,
	type Submission,
	type DefaultValue,
	type Form as FormMetadata,
	createRegistry,
	// invariant,
	flatten,
	resolve,
	requestIntent,
	validate,
} from '@conform-to/dom/experimental';
import {
	createContext,
	createElement,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	useCallback,
} from 'react';

export type FieldName<Type> = string & { __type?: Type };

export interface Form<Type>
	extends Pick<
		Fieldset<Type>,
		'id' | 'descriptionId' | 'errorId' | 'errors' | 'fields'
	> {
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => any;
	noValidate: boolean;
}

export interface Fieldset<Type> extends Omit<Field<Type>, 'name'> {
	name: FieldName<Type> | undefined;
	fields: { [Key in KeysOf<Type>]: Field<KeyType<Type, Key>> };
}

export interface FieldList<Item> extends Field<Item[]> {
	list: Array<Field<Item> & { key: string }>;
}

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

const RegistryContext = createContext(createRegistry());

export function useRegistry(): Registry {
	return useContext(RegistryContext);
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

export function FormState({ formId }: { formId: string }): React.ReactElement {
	const form = useFormMetadata({ formId });

	return createElement(
		'fieldset',
		{ form: formId, hidden: true },
		createElement('input', {
			type: 'hidden',
			form: formId,
			name: '__state__',
			value: JSON.stringify(form.state),
		}),
	);
}

export function ConformBoundary({
	children,
}: {
	children: React.ReactNode;
}): React.ReactElement {
	const [registry] = useState(() => createRegistry());

	return createElement(RegistryContext.Provider, { value: registry }, children);
}

export function useFormMetadata(config: {
	formId: string;
	name?: string;
	state?: {
		error?: boolean;
		list?: boolean;
		validated?: boolean;
	};
}): FormMetadata {
	const registry = useRegistry();
	const store = useMemo(
		() => ({
			subscribe: (callback: () => void) =>
				registry.subscribe(config.formId, callback, (update) => {
					if (
						typeof config.name !== 'undefined' &&
						update.name !== config.name
					) {
						return false;
					}

					const state = {
						error: config.state?.error,
						validated: config.state?.validated,
						list: config.state?.list,
					};

					return state?.[update.type] ?? false;
				}),
			getState: () => registry.getForm(config.formId),
		}),
		[
			registry,
			config.formId,
			config.name,
			config.state?.error,
			config.state?.list,
			config.state?.validated,
		],
	);
	const state = useSyncExternalStore(
		store.subscribe,
		store.getState,
		// Uses the same snapshot for server rendering / hydration.
		store.getState,
	);

	return state;
}

export function generateIds(formId: string, name: string) {
	const id = name ? `${formId}-${name}` : formId;

	return {
		id,
		formId,
		errorId: `${id}-error`,
		descriptionId: `${id}-description`,
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
	}: SubmissionContext) => Submission<any, Type>;
}): Form<Type> {
	const formId = useFormId(config.id);
	const registry = useRegistry();
	const registerForm = () =>
		registry.add(
			formId,
			{
				defaultValue: flatten(config.defaultValue ?? {}),
				constraint: config.constraint ?? {},
			},
			config.lastResult,
		);
	const [form, setForm] = useState(registerForm);

	// If id changes, reinitialize the form immediately
	if (formId !== form.id) {
		setForm(registerForm);
	}

	useEffect(() => {
		// Cleanup the form metadata when the component unmounts
		return () => registry.remove(formId);
	}, [registry, formId]);

	const noValidate = useNoValidate(config.defaultNoValidate);
	const configRef = useRef(config);
	const { errorId, descriptionId, fields, errors } = useFieldset<Type>({
		formId,
	});

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
					requestIntent(form, validate(element.name));
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
		errorId,
		descriptionId,
		onSubmit,
		noValidate,
		errors,
		fields,
	};
}

export function useFieldset<Type>(config: {
	formId: string;
	name?: FieldName<Type>;
}): Fieldset<Type> {
	const field = useField({ formId: config.formId, name: config.name ?? '' });
	const metadata = useFormMetadata({
		formId: config.formId,
		name: config.name,
		state: {
			error: true,
		},
	});

	return {
		...field,
		name: field.name !== '' ? field.name : undefined,
		fields: new Proxy({} as { [Key in KeysOf<Type>]: Field<KeyType<Type, Key>> }, {
			get(_target, key: unknown): Field<any> | undefined {
				if (typeof key !== 'string') {
					return;
				}

				const name = config.name ? `${config.name}.${key}` : key;

				return {
					...generateIds(config.formId, name),
					name,
					defaultValue: metadata.initialValue[name],
					constraint: metadata.attributes.constraint[name] ?? {},
					errors: metadata.error[name] ?? [],
				};
			},
		}),
	};
}

export function useFieldList<Item>(config: {
	formId: string;
	name: FieldName<Item[]>;
}): FieldList<Item> {
	const field = useField({
		...config,
		// intent: list,
	});
	const metadata = useFormMetadata({
		...config,
		state: {
			error: true,
			list: true,
		},
	});
	const entries =
		metadata.state.list[config.name] ??
		Object.keys(resolve(metadata.initialValue, config.name) ?? {});

	return {
		...field,
		list: entries.map((key, index) => {
			const name = `${config.name}[${index}]`;

			return {
				...generateIds(config.formId, name),
				key,
				name,
				defaultValue: metadata.initialValue[name] as Item | string | undefined,
				constraint: metadata.attributes.constraint[name] ?? {},
				errors: metadata.error[name] ?? [],
			};
		}),
	};
}

export function useField<Type>(config: {
	formId: string;
	name: FieldName<Type>;
	intent?: Record<string, any>;
}): Field<Type> {
	const metadata = useFormMetadata({
		formId: config.formId,
		name: config.name,
		state: {
			error: true,
		},
	});
	const name = config.name;

	return {
		...generateIds(config.formId, name),
		name,
		defaultValue: metadata.initialValue[name] as any,
		constraint: metadata.attributes.constraint[name] ?? {},
		errors: metadata.error[name] ?? [],
		// TODO: bind each intent creator with the formId and name
		// intent: config.intent,
	};
}
