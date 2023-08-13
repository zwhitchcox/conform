import { setValue } from './formdata.js';

export function invariant(
	expectedCondition: boolean,
	message: string,
): asserts expectedCondition {
	if (!expectedCondition) {
		throw new Error(message);
	}
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

export function resolve(
	defaultValue: Record<string, unknown>,
	prefix: string,
): unknown | undefined {
	const result: { target?: unknown } = {};

	for (const [key, value] of Object.entries(defaultValue)) {
		if (!key.startsWith(prefix)) {
			continue;
		}

		const name = `target${key.slice(prefix.length)}`;

		setValue(result, name, (prev) => {
			if (!prev) {
				return value;
			} else if (Array.isArray(prev)) {
				return prev.concat(value);
			} else {
				return [prev, value];
			}
		});
	}

	return result.target;
}
