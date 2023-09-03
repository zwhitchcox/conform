import {
	type Submission,
	type SubmissionResult,
	type ReportOptions,
	type FormState,
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

function mergeValue<Type extends FormDataEntryValue>(
	prev: Type | Type[] | undefined,
	next: Type,
): Type | Type[];
function mergeValue<Type extends FormDataEntryValue>(
	prev: Type | Type[] | undefined,
	next: Type[],
): Type[];
function mergeValue<Type extends FormDataEntryValue>(
	prev: Type | Type[] | undefined,
	next: Type | Type[],
): Type | Type[] {
	if (!prev) {
		return next;
	} else if (Array.isArray(prev)) {
		return prev.concat(next);
	} else {
		return ([] as Type[]).concat(prev, next);
	}
}

function getError(
	{ errors }: ZodError,
	validated: Record<string, boolean>,
	defaultValidated = false,
): Record<string, string[]> {
	return errors.reduce<Record<string, string[]>>((result, error) => {
		const name = formatPaths(error.path);

		if (defaultValidated && typeof validated[name] === 'undefined') {
			validated[name] = true;
		}

		if (validated[name] ?? defaultValidated) {
			result[name] = mergeValue(result[name], [error.message]);
		}

		return result;
	}, {});
}

function resolveState(payload: FormData | URLSearchParams): FormState {
	const prevState = payload.get('__state__');

	invariant(typeof prevState === 'string', 'Invalid state');

	return JSON.parse(prevState);
}

function resolveIntent(payload: FormData | URLSearchParams) {
	const intent = payload.get('__intent__');

	if (!intent) {
		return {
			intent: null,
			result: null,
		};
	}

	invariant(typeof intent === 'string', 'Invalid intent');

	return {
		intent,
		result: parseIntent(intent),
	};
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

function createSubmission<Input, Output>(
	result: SafeParseReturnType<Input, Output>,
	context: {
		intent: string | null;
		state: any | null;
		initialValue: Record<string, string | string[]> | null;
	},
): Submission<Output> {
	if (!result.success || context.intent) {
		const error = !result.success
			? getError(result.error, context.state.validated, context.intent === null)
			: {};

		return {
			state: !result.success ? 'rejected' : 'pending',
			report(options) {
				return report(
					{
						initialValue: context.initialValue,
						error,
						state: context.state,
						autoFocus: context.intent === null,
					},
					options,
				);
			},
		};
	}

	return {
		state: 'accepted',
		intent: context.intent,
		value: result.data,
		report(options) {
			return report(
				{
					initialValue: context.initialValue,
					error: {},
					state: context.state,
					autoFocus: context.intent === null,
				},
				options,
			);
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
	const { intent, result } = resolveIntent(payload);
	const state = resolveState(payload);
	const data: Record<string, unknown> = {};

	for (const [name, value] of payload.entries()) {
		if (name === '__intent__' || name === '__state__') {
			continue;
		}

		setValue(data, name, (prev) => mergeValue(prev as any, value));

		if (!result) {
			state.validated[name] = true;
		}
	}

	switch (result?.type) {
		case 'validate': {
			state.validated[result.payload] = true;
			break;
		}
		case 'list': {
			const list = setValue(data, result.payload.name, (list: unknown) => {
				if (typeof list !== 'undefined' && !Array.isArray(list)) {
					throw new Error('The list intent can only be applied to a list');
				}

				return list ?? [];
			});
			const keys = state.listKeys[result.payload.name] ?? Object.keys(list);

			updateList(list, result.payload);

			switch (result.payload.operation) {
				case 'append':
				case 'prepend':
				case 'replace':
					updateList<string>(keys, {
						...result.payload,
						defaultValue: (Date.now() * Math.random()).toString(36),
					});
					break;
				default:
					updateList(keys, result.payload);
					break;
			}

			if (
				result.payload.operation === 'remove' ||
				result.payload.operation === 'replace'
			) {
				for (const name of Object.keys(state.validated)) {
					if (
						name.startsWith(`${result.payload.name}[${result.payload.index}]`)
					) {
						state.validated[name] = false;
					}
				}
			}

			state.validated[result.payload.name] = true;
			state.listKeys[result.payload.name] = keys;
			break;
		}
	}

	const errorMap = options.errorMap;
	const schema = enableTypeCoercion(
		typeof options.schema === 'function'
			? options.schema(intent)
			: options.schema,
	);
	const initialValue = flatten(data);

	return options.async
		? schema.safeParseAsync(data, { errorMap }).then((result) =>
				createSubmission(result, {
					intent,
					state,
					initialValue,
				}),
		  )
		: createSubmission(schema.safeParse(data, { errorMap }), {
				intent,
				state,
				initialValue,
		  });
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
