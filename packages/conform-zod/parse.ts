import {
	type FormState,
	type Submission,
	type SubmissionResult,
	type ReportOptions,
	flatten,
	invariant,
	formatPaths,
	parseIntent,
	setValue,
	updateList,
} from '@conform-to/dom';
import {
	type IssueData,
	type SafeParseReturnType,
	type input,
	type output,
	type RefinementCtx,
	type ZodTypeAny,
	type ZodError,
	type ZodErrorMap,
	ZodIssueCode,
} from 'zod';
import { enableTypeCoercion } from './coercion.js';

function resolve(payload: FormData | URLSearchParams) {
	const state = payload.get('__state__');
	const intent = payload.get('__intent__');
	const data: Record<string, unknown> = {};
	const fields: string[] = [];

	invariant(
		typeof state === 'string' &&
			(typeof intent === 'string' || intent === null),
		'Invalid form data',
	);

	for (const [name, next] of payload.entries()) {
		if (name === '__intent__' || name === '__state__') {
			continue;
		}

		fields.push(name);
		setValue(data, name, (prev) => {
			if (!prev) {
				return next;
			} else if (Array.isArray(prev)) {
				return prev.concat(next);
			} else {
				return [prev, next];
			}
		});
	}

	return {
		data,
		intent,
		state: JSON.parse(state),
		fields,
	};
}

function getError({ errors }: ZodError): Record<string, string[]> {
	return errors.reduce<Record<string, string[]>>((result, error) => {
		const name = formatPaths(error.path);
		const messages = result[name] ?? [];

		messages.push(error.message);

		result[name] = messages;

		return result;
	}, {});
}

function report(
	result: SubmissionResult,
	options?: ReportOptions,
): SubmissionResult {
	if (options?.resetForm) {
		return {
			initialValue: null,
			error: {},
			state: {
				validated: {},
				listKeys: {},
			},
			autoFocus: false,
		};
	}

	return result;
}

interface SubmissionContext<Value> {
	initialValue: Record<string, string | string[]> | null;
	value: Value | null;
	error: Record<string, string[]>;
	state: FormState;
	pending: boolean;
}

function createSubmission<Value>(
	context: SubmissionContext<Value>,
): Submission<Value> {
	const result: SubmissionResult = {
		initialValue: context.initialValue,
		error: !context.pending
			? context.error
			: Object.entries(context.error).reduce<Record<string, string[]>>(
					(result, [name, messages]) => {
						if (context.state.validated[name]) {
							result[name] = messages;
						}

						return result;
					},
					{},
			  ),
		state: context.state,
		autoFocus: !context.pending,
	};

	if (context.pending) {
		return {
			state: 'pending',
			report(options) {
				return report(result, options);
			},
		};
	}

	if (!context.value) {
		return {
			state: 'rejected',
			report(options) {
				return report(result, options);
			},
		};
	}

	return {
		state: 'accepted',
		value: context.value,
		report(options) {
			return report(result, options);
		},
	};
}

interface FormContext {
	intent: string | null;
	state: FormState;
	data: Record<string, unknown>;
	fields: string[];
}

export function preprocess(
	form: FormContext,
): (error: Record<string, string[]>) => void {
	const intent = form.intent ? parseIntent(form.intent) : null;

	switch (intent?.type) {
		case 'validate':
			return () => {
				form.state.validated[intent.payload] = true;
			};
		case 'list':
			const payload = intent.payload;
			const list = setValue(form.data, intent.payload.name, (list: unknown) => {
				if (typeof list !== 'undefined' && !Array.isArray(list)) {
					throw new Error('The list intent can only be applied to a list');
				}

				return list ?? [];
			});
			const defaultListKeys = Object.keys(list);

			updateList(list, intent.payload);

			return () => {
				const keys = form.state.listKeys[payload.name] ?? defaultListKeys;

				switch (payload.operation) {
					case 'append':
					case 'prepend':
					case 'replace':
						updateList(keys, {
							...payload,
							defaultValue: (Date.now() * Math.random()).toString(36),
						});
						break;
					default:
						updateList(keys, payload);
						break;
				}

				form.state.listKeys[payload.name] = keys;

				if (payload.operation === 'remove' || payload.operation === 'replace') {
					for (const name of Object.keys(form.state.validated)) {
						if (name.startsWith(`${payload.name}[${payload.index}]`)) {
							form.state.validated[name] = false;
						}
					}
				}

				form.state.validated[payload.name] = true;
			};
		default:
			return (error) => {
				for (const name of [...form.fields, ...Object.keys(error)]) {
					form.state.validated[name] = true;
				}
			};
	}
}

export function parse<Schema extends ZodTypeAny>(
	payload: FormData | URLSearchParams,
	options: {
		schema: Schema | ((intent: string) => Schema);
		async?: false;
		errorMap?: ZodErrorMap;
	},
): Submission<output<Schema>, input<Schema>>;
export function parse<Schema extends ZodTypeAny>(
	payload: FormData | URLSearchParams,
	options: {
		schema: Schema | ((intent: string) => Schema);
		async: true;
		errorMap?: ZodErrorMap;
	},
): Promise<Submission<output<Schema>, input<Schema>>>;
export function parse<Schema extends ZodTypeAny>(
	payload: FormData | URLSearchParams,
	options: {
		schema: Schema | ((intent: string | null) => Schema);
		async?: boolean;
		errorMap?: ZodErrorMap;
	},
):
	| Submission<output<Schema>, input<Schema>>
	| Promise<Submission<output<Schema>, input<Schema>>> {
	const form = resolve(payload);
	const update = preprocess(form);
	const errorMap = options.errorMap;
	const schema = enableTypeCoercion(
		typeof options.schema === 'function'
			? options.schema(form.intent)
			: options.schema,
	);
	const resolveSubmission = <Input, Output>(
		result: SafeParseReturnType<Input, Output>,
		context: {
			intent: string | null;
			state: any | null;
			data: Record<string, unknown>;
			fields: string[];
		},
		updateState: (error: Record<string, string[]>) => void,
	): Submission<Output> => {
		const error = !result.success ? getError(result.error) : {};

		updateState(error);

		return createSubmission({
			initialValue: flatten(context.data),
			state: context.state,
			pending: context.intent !== null,
			value: result.success ? result.data : null,
			error,
		});
	};

	return options.async
		? schema
				.safeParseAsync(form.data, { errorMap })
				.then((result) => resolveSubmission(result, form, update))
		: resolveSubmission(
				schema.safeParse(form.data, { errorMap }),
				form,
				update,
		  );
}

/**
 * A helper function to define a custom constraint on a superRefine check.
 * Mainly used for async validation.
 *
 * @see https://conform.guide/api/zod#refine
 */
export function refine(
	ctx: RefinementCtx,
	options: {
		/**
		 * A validate function. If the function returns `undefined`,
		 * it will fallback to server validation.
		 */
		validate: () => boolean | Promise<boolean> | undefined;
		/**
		 * Define when the validation should be run. If the value is `false`,
		 * the validation will be skipped.
		 */
		when?: boolean;
		/**
		 * The message displayed when the validation fails.
		 */
		message: string;
		/**
		 * The path set to the zod issue.
		 */
		path?: IssueData['path'];
	},
): void | Promise<void> {
	if (typeof options.when !== 'undefined' && !options.when) {
		ctx.addIssue({
			code: ZodIssueCode.custom,
			message: '__VALIDATION_SKIPPED__',
			path: options.path,
		});
		return;
	}

	// Run the validation
	const result = options.validate();

	if (typeof result === 'undefined') {
		// Validate only if the constraint is defined
		ctx.addIssue({
			code: ZodIssueCode.custom,
			message: `__VALIDATION_UNDEFINED__`,
			path: options.path,
		});
		return;
	}

	const reportInvalid = (valid: boolean) => {
		if (valid) {
			return;
		}

		ctx.addIssue({
			code: ZodIssueCode.custom,
			message: options.message,
			path: options.path,
		});
	};

	return typeof result === 'boolean'
		? reportInvalid(result)
		: result.then(reportInvalid);
}
