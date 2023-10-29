import {
	type FieldName,
	FormProvider,
	useForm,
	useFieldset,
	useFieldList,
	conform,
	intent,
} from '@conform-to/react';
import { parse } from '@conform-to/zod';
import type { ActionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, useActionData } from '@remix-run/react';
import { z } from 'zod';

const taskSchema = z.object({
	content: z.string(),
	completed: z.boolean().optional(),
});

const todosSchema = z.object({
	title: z.string(),
	tasks: z.array(taskSchema).nonempty(),
});

export async function action({ request }: ActionArgs) {
	const formData = await request.formData();
	const submission = parse(formData, {
		schema: todosSchema,
	});

	if (!submission.ready) {
		return json(submission.reject());
	}

	return redirect(`/?value=${JSON.stringify(submission.value)}`);
}

export default function TodoForm() {
	const lastResult = useActionData<typeof action>();
	const { config, fields, context } = useForm<z.input<typeof todosSchema>>({
		lastResult,
		onValidate({ formData }) {
			return parse(formData, { schema: todosSchema });
		},
		shouldValidate: 'onBlur',
	});
	const tasks = useFieldList({
		form: config.id,
		name: fields.tasks.name,
		context,
	});

	return (
		<FormProvider formId={config.id} context={context}>
			<Form method="post" {...conform.form(config)}>
				<div>
					<label>Title</label>
					<input
						className={fields.title.errors.length > 0 ? 'error' : ''}
						{...conform.input(fields.title)}
					/>
					<div id={fields.title.errorId}>{fields.title.errors}</div>
				</div>
				<hr />
				<div className="form-error">{fields.tasks.errors}</div>
				{tasks.map((task, index) => (
					<p key={task.key}>
						<TaskFieldset
							title={`Task #${index + 1}`}
							{...conform.fieldset(task)}
						/>
						<button
							{...intent.list(fields.tasks, { operation: 'remove', index })}
						>
							Delete
						</button>
						<button
							{...intent.list(fields.tasks, {
								operation: 'reorder',
								from: index,
								to: 0,
							})}
						>
							Move to top
						</button>
						<button
							{...intent.list(fields.tasks, {
								operation: 'replace',
								index,
								defaultValue: { content: '' },
							})}
						>
							Clear
						</button>
					</p>
				))}
				<button
					{...intent.list(fields.tasks, {
						operation: 'append',
						defaultValue: {
							content: '',
							completed: false,
						},
					})}
				>
					Add task
				</button>
				<hr />
				<button>Save</button>
			</Form>
		</FormProvider>
	);
}

interface TaskFieldsetProps {
	name: FieldName<z.input<typeof taskSchema>>;
	form: string;
	title: string;
}

function TaskFieldset({ title, name, form }: TaskFieldsetProps) {
	const task = useFieldset({
		form,
		name,
	});

	return (
		<fieldset>
			<div>
				<label>{title}</label>
				<input
					className={task.content.errors.length > 0 ? 'error' : ''}
					{...conform.input(task.content)}
				/>
				<div>{task.content.errors}</div>
			</div>
			<div>
				<label>
					<span>Completed</span>
					<input
						className={task.completed.errors.length > 0 ? 'error' : ''}
						{...conform.input(task.completed, {
							type: 'checkbox',
						})}
					/>
				</label>
			</div>
		</fieldset>
	);
}
