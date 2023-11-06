import {
	type FieldName,
	ConformBoundary,
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
	const form = useForm<z.input<typeof todosSchema>>({
		lastResult,
		onValidate({ formData }) {
			return parse(formData, { schema: todosSchema });
		},
	});
	const tasks = useFieldList({
		formId: form.id,
		name: form.fields.tasks.name,
		context: form.context,
	});

	return (
		<ConformBoundary context={form.context}>
			<Form method="post" {...conform.form(form)}>
				<div>
					<label>Title</label>
					<input
						className={form.fields.title.errors.length > 0 ? 'error' : ''}
						{...conform.input(form.fields.title)}
					/>
					<div id={form.fields.title.errorId}>{form.fields.title.errors}</div>
				</div>
				<hr />
				<div className="form-error">{form.fields.tasks.errors}</div>
				{tasks.map((task, index) => (
					<p key={task.key}>
						<TaskFieldset
							title={`Task #${index + 1}`}
							name={task.name}
							form={task.formId}
						/>
						<button
							{...intent.list(form.fields.tasks, {
								operation: 'remove',
								index,
							})}
						>
							Delete
						</button>
						<button
							{...intent.list(form.fields.tasks, {
								operation: 'reorder',
								from: index,
								to: 0,
							})}
						>
							Move to top
						</button>
						<button
							{...intent.list(form.fields.tasks, {
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
					{...intent.list(form.fields.tasks, {
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
		</ConformBoundary>
	);
}

interface TaskFieldsetProps {
	name: FieldName<z.input<typeof taskSchema>>;
	form: string;
	title: string;
}

function TaskFieldset({ title, name, form }: TaskFieldsetProps) {
	const task = useFieldset({
		formId: form,
		name,
	});

	return (
		<fieldset>
			<div>
				<label>{title}</label>
				<input
					className={!task.content.valid ? 'error' : ''}
					{...conform.input(task.content)}
				/>
				<div>{task.content.errors}</div>
			</div>
			<div>
				<label>
					<span>Completed</span>
					<input
						className={!task.completed.valid ? 'error' : ''}
						{...conform.input(task.completed, {
							type: 'checkbox',
						})}
					/>
				</label>
			</div>
		</fieldset>
	);
}
