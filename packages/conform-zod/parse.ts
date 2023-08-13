import {
	type Submission,
	type SubmissionResult,
	type ReportOptions,
	type FormState,
	type FormUpdate,
	flatten,
	invariant,
	formatPaths,
	parseIntent as oldParseIntent,
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

function parseState(payload: FormData | URLSearchParams): FormState {
	const prevState = payload.get('__state__');

	if (!prevState) {
		return {
			validated: {},
			list: {},
		};
	}

	invariant(typeof prevState === 'string', 'Invalid state');

	return JSON.parse(prevState);
}

function parseIntent(payload: FormData | URLSearchParams) {
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
		result: oldParseIntent(intent),
	};
}

function report(
	result: SubmissionResult,
	options?: ReportOptions,
): SubmissionResult {
	if (options?.resetForm) {
		return {
			payload: null,
			error: {},
			state: {
				validated: {},
				list: {},
			},
		};
	}

	return result;
}

function createSubmission<Input, Output>(
	result: SafeParseReturnType<Input, Output>,
	context: {
		intent: string | null;
		state: any | null;
		defaultValue: Record<string, string | string[]> | null;
		update?: FormUpdate;
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
						payload: context.defaultValue,
						error,
						state: context.state,
						update: context.update,
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
					payload: context.defaultValue,
					error: {},
					state: context.state,
					update: context.update,
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
	const { intent, result } = parseIntent(payload);
	const state = parseState(payload);
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

	let update: FormUpdate | undefined = undefined;

	switch (result?.type) {
		case 'validate': {
			state.validated[result.payload] = true;
			update = {
				focusField: false,
			};
			break;
		}
		case 'list': {
			const defaultList = setValue(data, result.payload.name, (list) => {
				if (typeof list !== 'undefined' && !Array.isArray(list)) {
					throw new Error('The list intent can only be applied to a list');
				}

				return updateList(list ?? [], result.payload);
			});

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
			update = {
				focusField: false,
				remove: [result.payload.name],
				override: flatten(defaultList, result.payload.name),
			};

			let list = state.list[result.payload.name];

			if (!list) {
				list = Object.keys(defaultList);
			} else {
				switch (result.payload.operation) {
					case 'append':
					case 'prepend':
					case 'replace':
						updateList<string>(list, {
							...result.payload,
							defaultValue: (Date.now() * Math.random()).toString(36),
						});
						break;
					default:
						updateList(list, result.payload);
						break;
				}
			}

			state.list[result.payload.name] = list;
			break;
		}
	}

	const errorMap = options.errorMap;
	const schema = enableTypeCoercion(
		typeof options.schema === 'function'
			? options.schema(intent)
			: options.schema,
	);
	const defaultValue = flatten(data);

	return options.async
		? schema.safeParseAsync(data, { errorMap }).then((result) =>
				createSubmission(result, {
					intent,
					state,
					update,
					defaultValue,
				}),
		  )
		: createSubmission(schema.safeParse(data, { errorMap }), {
				intent,
				state,
				update,
				defaultValue,
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
			message: `[VALIDATION_SKIPPED] ${options.message}`,
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
			message: `[VALIDATION_UNDEFINED] ${options.message}`,
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
