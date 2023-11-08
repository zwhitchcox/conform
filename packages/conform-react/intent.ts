import {
	type FieldName,
	type ListIntentPayload,
	INTENT,
	list as listIntent,
	validate as validateIntent,
} from '@conform-to/dom';

type Field<Schema> = {
	name: FieldName<Schema>;
	formId?: string;
};

type OmitKey<T, K extends string> = T extends any ? Omit<T, K> : never;

function createIntentButtonProps(value: string, form?: string) {
	return {
		name: INTENT,
		value,
		form,
		formNoValidate: true,
	};
}

export function validate<Schema>(field: Field<Schema>) {
	return createIntentButtonProps(
		validateIntent.serialize(field.name),
		field.formId,
	);
}

export function list<Schema>(
	field: Field<Array<Schema>>,
	payload: OmitKey<ListIntentPayload<Schema>, 'name'>,
) {
	return createIntentButtonProps(
		listIntent.serialize({ name: field.name, ...payload }),
		field.formId,
	);
}
