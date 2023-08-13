/**
 * A ponyfill-like helper to get the form data with the submitter value.
 * It does not respect the tree order nor handles the image input.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/FormData/FormData#parameters
 */

export function getFormData(
	form: HTMLFormElement,
	submitter?: HTMLInputElement | HTMLButtonElement | null,
): FormData {
	const payload = new FormData(form);

	if (submitter && submitter.type === 'submit' && submitter.name !== '') {
		payload.append(submitter.name, submitter.value);
	}

	return payload;
}

/**
 * Returns the paths from a name based on the JS syntax convention
 * @example
 * ```js
 * const paths = getPaths('todos[0].content'); // ['todos', 0, 'content']
 * ```
 */
export function getPaths(name: string): Array<string | number> {
	if (!name) {
		return [];
	}

	return name
		.split(/\.|(\[\d*\])/)
		.reduce<Array<string | number>>((result, segment) => {
			if (typeof segment !== 'undefined' && segment !== '') {
				if (segment.startsWith('[') && segment.endsWith(']')) {
					const index = segment.slice(1, -1);

					result.push(Number(index));
				} else {
					result.push(segment);
				}
			}
			return result;
		}, []);
}

/**
 * Returns a formatted name from the paths based on the JS syntax convention
 * @example
 * ```js
 * const name = formatPaths(['todos', 0, 'content']); // "todos[0].content"
 * ```
 */
export function formatPaths(paths: Array<string | number>): string {
	return paths.reduce<string>((name, path) => {
		if (typeof path === 'number') {
			return `${name}[${path}]`;
		}

		if (name === '' || path === '') {
			return [name, path].join('');
		}

		return [name, path].join('.');
	}, '');
}

/**
 * Assign a value to a target object by following the paths on the name
 */
export function setValue<Value>(
	target: Record<string, any>,
	name: string,
	valueFn: (prev?: unknown) => Value,
): Value {
	const paths = getPaths(name);
	const length = paths.length;
	const lastIndex = length - 1;

	let index = -1;
	let pointer = target;

	while (pointer != null && ++index < length) {
		const key = paths[index] as string | number;
		const nextKey = paths[index + 1];
		const newValue =
			index != lastIndex
				? pointer[key] ?? (typeof nextKey === 'number' ? [] : {})
				: valueFn(pointer[key]);

		pointer[key] = newValue;
		pointer = pointer[key];
	}

	// @ts-expect-error: The pointer should be assigned with the result of the valueFn
	return pointer;
}

/**
 * Resolves the payload into a plain object based on the JS syntax convention
 */
export function resolve(
	payload: FormData | URLSearchParams,
	options: {
		ignoreKeys?: string[];
	} = {},
) {
	const data = {};

	for (const [key, value] of payload.entries()) {
		if (options.ignoreKeys?.includes(key)) {
			continue;
		}

		setValue(data, key, (prev) => {
			if (!prev) {
				return value;
			} else if (Array.isArray(prev)) {
				return prev.concat(value);
			} else {
				return [prev, value];
			}
		});
	}

	return data;
}

/**
 * Format the error messages into a validation message
 */
export function getValidationMessage(
	errors?: string[],
	delimiter = String.fromCharCode(31),
): string {
	return errors?.join(delimiter) ?? '';
}
