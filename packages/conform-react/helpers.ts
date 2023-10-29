import type { FormConfig, Field } from './hooks.js';
import type { CSSProperties, HTMLInputTypeAttribute } from 'react';

interface FormElementProps {
	id?: string;
	name?: string;
	form?: string;
	'aria-describedby'?: string;
	'aria-invalid'?: boolean;
}

interface FormControlProps extends FormElementProps {
	required?: boolean;
	autoFocus?: boolean;
	tabIndex?: number;
	style?: CSSProperties;
	'aria-hidden'?: boolean;
}

interface InputProps extends FormControlProps {
	type?: HTMLInputTypeAttribute;
	minLength?: number;
	maxLength?: number;
	min?: string | number;
	max?: string | number;
	step?: string | number;
	pattern?: string;
	multiple?: boolean;
	value?: string;
	defaultChecked?: boolean;
	defaultValue?: string;
}

interface SelectProps extends FormControlProps {
	defaultValue?: string | number | readonly string[] | undefined;
	multiple?: boolean;
}

interface TextareaProps extends FormControlProps {
	minLength?: number;
	maxLength?: number;
	defaultValue?: string;
}

type Primitive = string | number | boolean | Date | null | undefined;

type BaseOptions =
	| {
			ariaAttributes?: true;
			description?: boolean;
	  }
	| {
			ariaAttributes: false;
	  };

type ControlOptions = BaseOptions & {
	hidden?: boolean;
};

type FormOptions = BaseOptions & {
	onSubmit: (
		event: React.FormEvent<HTMLFormElement>,
		context: ReturnType<FormConfig['onSubmit']>,
	) => void;
};

type InputOptions = ControlOptions &
	(
		| {
				type: 'checkbox' | 'radio';
				value?: string;
		  }
		| {
				type?: Exclude<HTMLInputTypeAttribute, 'button' | 'submit' | 'hidden'>;
				value?: never;
		  }
	);

/**
 * Cleanup `undefined` from the dervied props
 * To minimize conflicts when merging with user defined props
 */
function cleanup<Props>(props: Props): Props {
	for (const key in props) {
		if (props[key] === undefined) {
			delete props[key];
		}
	}

	return props;
}

function getAriaAttributes<
	Config extends {
		id: string;
		errorId: string;
		descriptionId: string;
		errors: string[];
	},
>(config: Config, options: BaseOptions = {}) {
	const hasAriaAttributes = options.ariaAttributes ?? true;

	return cleanup({
		'aria-invalid':
			(hasAriaAttributes && config.errorId && config.errors.length > 0) ||
			undefined,
		'aria-describedby': hasAriaAttributes
			? [
					config.errorId && config.errors.length > 0
						? config.errorId
						: undefined,
					config.descriptionId &&
					options.ariaAttributes !== false &&
					options.description
						? config.descriptionId
						: undefined,
			  ].reduce((result, id) => {
					if (!result) {
						return id;
					}

					if (!id) {
						return result;
					}

					return `${result} ${id}`;
			  })
			: undefined,
	});
}

function getFormElementProps<
	Config extends {
		id: string;
		name?: string;
		formId: string;
		errorId: string;
		descriptionId: string;
		errors: string[];
	},
>(config: Config, options: BaseOptions = {}): FormElementProps {
	return cleanup({
		id: config.id,
		name: config.name,
		form: config.formId,
		...getAriaAttributes(config, options),
	});
}

function getFormControlProps(
	field: Field<unknown>,
	options?: ControlOptions,
): FormControlProps {
	return cleanup({
		...getFormElementProps(field, options),
		required: field.constraint.required,
		// FIXME: something to differentiate if the form is reloaded
		autoFocus: false,
		...(options?.hidden ? hiddenProps : undefined),
	});
}

export const hiddenProps: {
	style: CSSProperties;
	tabIndex: number;
	'aria-hidden': boolean;
} = {
	/**
	 * Style to make the input element visually hidden
	 * Based on the `sr-only` class from tailwindcss
	 */
	style: {
		position: 'absolute',
		width: '1px',
		height: '1px',
		padding: 0,
		margin: '-1px',
		overflow: 'hidden',
		clip: 'rect(0,0,0,0)',
		whiteSpace: 'nowrap',
		border: 0,
	},
	tabIndex: -1,
	'aria-hidden': true,
};

export function input<Schema extends Primitive | unknown>(
	field: Field<Schema>,
	options?: InputOptions,
): InputProps;
export function input<Schema extends File | File[]>(
	field: Field<Schema>,
	options: InputOptions & { type: 'file' },
): InputProps;
export function input<Schema extends Primitive | File | File[] | unknown>(
	field: Field<Schema>,
	options: InputOptions = {},
): InputProps {
	const props: InputProps = {
		...getFormControlProps(field, options),
		type: options.type,
		minLength: field.constraint.minLength,
		maxLength: field.constraint.maxLength,
		min: field.constraint.min,
		max: field.constraint.max,
		step: field.constraint.step,
		pattern: field.constraint.pattern,
		multiple: field.constraint.multiple,
	};

	if (options.type === 'checkbox' || options.type === 'radio') {
		props.value = options.value ?? 'on';
		props.defaultChecked =
			typeof field.defaultValue === 'boolean'
				? field.defaultValue
				: field.defaultValue === props.value;
	} else if (options.type !== 'file') {
		props.defaultValue = `${field.defaultValue ?? ''}`;
	}

	return cleanup(props);
}

export function select<
	Schema extends Primitive | Primitive[] | undefined | unknown,
>(field: Field<Schema>, options?: ControlOptions): SelectProps {
	return cleanup({
		...getFormControlProps(field, options),
		defaultValue: Array.isArray(field.defaultValue)
			? field.defaultValue
			: `${field.defaultValue ?? ''}`,
		multiple: field.constraint.multiple,
	});
}

export function textarea<Schema extends Primitive | undefined | unknown>(
	field: Field<Schema>,
	options?: ControlOptions,
): TextareaProps {
	return cleanup({
		...getFormControlProps(field, options),
		defaultValue: `${field.defaultValue ?? ''}`,
		minLength: field.constraint.minLength,
		maxLength: field.constraint.maxLength,
	});
}

export function form(config: FormConfig, options?: FormOptions) {
	return cleanup({
		id: config.id,
		onSubmit:
			typeof options?.onSubmit !== 'function'
				? config.onSubmit
				: (event: React.FormEvent<HTMLFormElement>) => {
						const context = config.onSubmit(event);

						if (!event.defaultPrevented) {
							options.onSubmit(event, context);
						}
				  },
		noValidate: config.noValidate,
		...getAriaAttributes(config, options),
	});
}

export function fieldset<
	Schema extends Record<string, unknown> | undefined | unknown,
>(field: Field<Schema>, options?: BaseOptions) {
	return cleanup({
		id: field.id,
		name: field.name,
		form: field.formId,
		...getAriaAttributes(field, options),
	});
}

export function collection<
	Schema extends
		| Array<string | boolean>
		| string
		| boolean
		| undefined
		| unknown,
>(
	field: Field<Schema>,
	options: BaseOptions & {
		type: 'checkbox' | 'radio';
		options: string[];
	},
): Array<InputProps & Pick<Required<InputProps>, 'type' | 'value'>> {
	return options.options.map((value) =>
		cleanup({
			...getFormControlProps(field, options),
			id: field.id ? `${field.id}-${value}` : undefined,
			type: options.type,
			value,
			defaultChecked:
				options.type === 'checkbox' && Array.isArray(field.defaultValue)
					? field.defaultValue.includes(value)
					: field.defaultValue === value,

			// The required attribute doesn't make sense for checkbox group
			// As it would require all checkboxes to be checked instead of at least one
			// It is overriden with `undefiend` so it could be cleaned upW properly
			required:
				options.type === 'checkbox' ? undefined : field.constraint.required,
		}),
	);
}
