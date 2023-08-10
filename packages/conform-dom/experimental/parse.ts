import { type FormState } from './registry.js';

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

export type FormUpdate = {
	focusField?: boolean;
	remove?: string[];
	override?: Record<string, unknown>;
};

export type SubmissionResult<Type = any> = {
	payload: Record<keyof Type | string, string | string[]> | null;
	error: Record<keyof Type | string, string[]>;
	state: FormState;
	update?: FormUpdate;
};

export type ReportOptions = {
	resetForm?: boolean;
}

export type Submission<Output, Input = Output> =
	| {
			state: 'pending' | 'rejected';
			report(options?: ReportOptions): SubmissionResult<Input>;
	  }
	| {
			state: 'accepted';
			intent: string | null;
			value: Output;
			report(options?: ReportOptions): SubmissionResult<Input>;
	  };