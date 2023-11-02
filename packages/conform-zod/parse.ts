import {
	type FormState,
	type Submission,
	type SubmissionResult,
	flatten,
	formatPaths,
	resolve,
	getIntentHandler,
	isPlainObject,
} from '@conform-to/dom';
import {
	type IssueData,
	type SafeParseReturnType,
	type output,
	type RefinementCtx,
	type ZodTypeAny,
	type ZodError,
	type ZodErrorMap,
	ZodIssueCode,
} from 'zod';
import { enableTypeCoercion } from './coercion.js';

function getError({ errors }: ZodError): Record<string, string[]> {
	return errors.reduce<Record<string, string[]>>((result, error) => {
		const name = formatPaths(error.path);
		const messages = result[name] ?? [];

		messages.push(error.message);

		result[name] = messages;

		return result;
	}, {});
}

interface SubmissionContext<Value> {
	initialValue: Record<string, string | string[]>;
	value: Value | null;
	error: Record<string, string[]>;
	state: FormState;
	pending: boolean;
}

function constructError(
	formErrors: string[] = [],
	fieldErrors: Record<string, string[]> = {},
) {
	const error = fieldErrors;

	if (formErrors.length > 0) {
		error[''] = formErrors;
	}

	return error;
}

function createSubmission<Value>(
	context: SubmissionContext<Value>,
): Submission<Value> {
	if (!context.value) {
		return {
			ready: false,
			pending: context.pending,
			payload: context.initialValue,
			error: context.error,
			reject(options) {
				const error = Object.entries(context.error).reduce<
					Record<string, string[]>
				>((result, [name, messages]) => {
					if (messages.length > 0 && context.state.validated[name]) {
						result[name] = (result[name] ?? []).concat(messages);
					}

					return result;
				}, constructError(options?.formErrors, options?.fieldErrors));

				return {
					status: context.pending ? 'updated' : 'failed',
					initialValue: context.initialValue,
					error,
					state: context.state,
				};
			},
			accept(options) {
				if (options?.resetForm) {
					return { status: 'accepted' };
				}

				return {
					status: 'accepted',
					initialValue: context.initialValue,
					error: context.error,
					state: context.state,
				};
			},
		};
	}

	return {
		ready: true,
		payload: context.initialValue,
		value: context.value,
		reject(options) {
			return {
				status: 'failed',
				initialValue: context.initialValue,
				error: constructError(options.formErrors, options.fieldErrors),
				state: context.state,
			};
		},
		accept(options) {
			if (options?.resetForm) {
				return { status: 'accepted' };
			}

			return {
				status: 'accepted',
				initialValue: context.initialValue,
				error: context.error,
				state: context.state,
			};
		},
	};
}

export function parse<Schema extends ZodTypeAny>(
	payload: FormData | URLSearchParams,
	options: {
		schema: Schema | ((intent: string) => Schema);
		async?: false;
		errorMap?: ZodErrorMap;
	},
): Submission<output<Schema>>;
export function parse<Schema extends ZodTypeAny>(
	payload: FormData | URLSearchParams,
	options: {
		schema: Schema | ((intent: string) => Schema);
		async: true;
		errorMap?: ZodErrorMap;
	},
): Promise<Submission<output<Schema>>>;
export function parse<Schema extends ZodTypeAny>(
	payload: FormData | URLSearchParams,
	options: {
		schema: Schema | ((intent: string | null) => Schema);
		async?: boolean;
		errorMap?: ZodErrorMap;
	},
): Submission<output<Schema>> | Promise<Submission<output<Schema>>> {
	const form = resolve(payload);
	const update = getIntentHandler(form);
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
		updateState: (result: Omit<Required<SubmissionResult>, 'status'>) => void,
	): Submission<Output> => {
		const error = !result.success ? getError(result.error) : {};
		const initialValue = flatten(context.data, {
			resolve(data) {
				// File cannot be serialized
				if (data instanceof File || isPlainObject(data)) {
					return null;
				} else if (typeof data === 'string') {
					return data;
				} else if (
					Array.isArray(data) &&
					data.every((item) => typeof item === 'string')
				) {
					return data;
				}

				throw new Error(`Invalid value: ${data}`);
			},
		}) as Record<string, string | string[]>;
		const state = context.state;

		updateState({
			initialValue,
			error,
			state,
		});

		return createSubmission({
			initialValue,
			state,
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
