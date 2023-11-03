export type Pretty<T> = { [K in keyof T]: T[K] } & {};

export type Primitive = null | undefined | string | number | boolean | Date;

export type KeysOf<T> = T extends any ? keyof T : never;

export type KeyType<T, K extends KeysOf<T>> = T extends { [k in K]?: any }
	? T[K]
	: undefined;

export type DefaultValue<Schema> = Schema extends Primitive
	? Schema | string
	: Schema extends File
	? undefined
	: Schema extends Array<infer InnerType>
	? Array<DefaultValue<InnerType>>
	: Schema extends Record<string, any>
	? { [Key in KeysOf<Schema>]?: DefaultValue<KeyType<Schema, Key>> }
	: any;

export type FieldName<Type> = string & { __type?: Type };

export type FieldElement =
	| HTMLInputElement
	| HTMLSelectElement
	| HTMLTextAreaElement;

export type FormControl = FieldElement | HTMLButtonElement;

export type Submitter = HTMLInputElement | HTMLButtonElement;

export type ResolveResult = {
	intent: string | null;
	state: FormState;
	data: Record<string, unknown>;
	fields: string[];
};

export type Constraint = {
	required?: boolean;
	minLength?: number;
	maxLength?: number;
	min?: string | number;
	max?: string | number;
	step?: string | number;
	multiple?: boolean;
	pattern?: string;
};

export type FormMetadata = {
	defaultValue: Record<string, unknown>;
	constraint: Record<string, Constraint>;
};

export type FormState = {
	validated: Record<string, boolean>;
	key: Record<string, Array<string>>;
};

export type SubmissionContext = {
	form: HTMLFormElement;
	submitter: HTMLInputElement | HTMLButtonElement | null;
	formData: FormData;
};

export type RejectOptions =
	| {
			formErrors: string[];
			fieldErrors?: Record<string, string[]>;
	  }
	| {
			formErrors?: string[];
			fieldErrors: Record<string, string[]>;
	  };

export type AcceptOptions = {
	resetForm?: boolean;
};

export type Submission<Output> =
	| {
			ready: false;
			pending: boolean;
			payload: Record<string, FormDataEntryValue | FormDataEntryValue[]>;
			error: Record<string, string[]>;
			reject(options?: RejectOptions): SubmissionResult;
			accept(options?: AcceptOptions): SubmissionResult;
	  }
	| {
			ready: true;
			payload: Record<string, FormDataEntryValue | FormDataEntryValue[]>;
			value: Output;
			reject(options: RejectOptions): SubmissionResult;
			accept(options?: AcceptOptions): SubmissionResult;
	  };

export type SubmissionResult = {
	status: 'updated' | 'failed' | 'accepted';
	initialValue?: Record<string, string | string[]>;
	error?: Record<string, string[]>;
	state?: FormState;
};
