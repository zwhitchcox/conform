import { FormState, conform, useForm } from '@conform-to/react/experimental';
import { parse } from '@conform-to/zod/experimental';
import { type LoaderArgs, type ActionArgs, json } from '@remix-run/node';
import { Form, useActionData, useLoaderData } from '@remix-run/react';
import { z } from 'zod';
import { Playground, Field } from '~/components';

const schema = z.object({
	singleChoice: z.string({ required_error: 'Required' }),
	multipleChoice: z.string().array().min(1, 'Required'),
});

export async function loader({ request }: LoaderArgs) {
	const url = new URL(request.url);

	return {
		noClientValidate: url.searchParams.get('noClientValidate') === 'yes',
	};
}

export async function action({ request }: ActionArgs) {
	const formData = await request.formData();
	const submission = parse(formData, { schema });

	return json(submission.report());
}

export default function Example() {
	const { noClientValidate } = useLoaderData<typeof loader>();
	const lastResult = useActionData<typeof action>();
	const form = useForm({
		id: 'collection',
		lastResult,
		shouldRevalidate: 'onInput',
		onValidate: !noClientValidate
			? ({ formData }) => parse(formData, { schema })
			: undefined,
	});

	return (
		<Form method="post" {...conform.form(form)}>
			<FormState formId={form.id} />
			<Playground title="Collection" lastSubmission={lastResult}>
				<Field label="Single choice" config={form.fields.singleChoice}>
					{conform
						.collection(form.fields.singleChoice, {
							type: 'radio',
							options: ['x', 'y', 'z'],
						})
						.map((props) => (
							<label key={props.value} className="inline-block">
								<input {...props} />
								<span className="p-2">{props.value?.toUpperCase()}</span>
							</label>
						))}
				</Field>
				<Field label="Multiple choice" config={form.fields.multipleChoice}>
					{conform
						.collection(form.fields.multipleChoice, {
							type: 'checkbox',
							options: ['a', 'b', 'c', 'd'],
						})
						.map((props) => (
							<label key={props.value} className="inline-block">
								<input {...props} />
								<span className="p-2">{props.value?.toUpperCase()}</span>
							</label>
						))}
				</Field>
			</Playground>
		</Form>
	);
}
