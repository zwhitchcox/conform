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

export function flatten(
	data: Record<string, unknown> | Array<unknown>,
	prefix: string = '',
): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {};

	function processObject(obj: Object, prefix: string): void {
		for (const [key, value] of Object.entries(obj)) {
			const name = prefix ? `${prefix}.${key}` : key;

			if (Array.isArray(value)) {
				processArray(value, name);
			} else if (value instanceof File) {
				continue;
			} else if (
				!(value instanceof Date) &&
				typeof value === 'object' &&
				value !== null
			) {
				processObject(value, name);
			} else {
				result[name] = value;
			}
		}
	}

	function processArray(array: any[], prefix: string): void {
		// This creates an additional entry in case of checkbox group
		if (array.every((item) => typeof item === 'string')) {
			result[prefix] = array as string[];
		}

		for (let i = 0; i < array.length; i++) {
			const item = array[i];
			const name = `${prefix}[${i}]`;

			if (Array.isArray(item)) {
				processArray(item, name);
			} else if (item instanceof File) {
				continue;
			} else if (
				!(item instanceof Date) &&
				typeof item === 'object' &&
				item !== null
			) {
				processObject(item, name);
			} else {
				result[name] = item;
			}
		}
	}

	if (Array.isArray(data)) {
		processArray(data, prefix);
	} else {
		processObject(data, prefix);
	}

	return result;
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
