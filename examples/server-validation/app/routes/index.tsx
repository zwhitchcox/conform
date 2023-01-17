import { conform, parse, hasError, useForm } from '@conform-to/react';
import type { ActionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData } from '@remix-run/react';

interface SignupForm {
	email: string;
	password: string;
	confirmPassword: string;
}

export async function action({ request }: ActionArgs) {
	const formData = await request.formData();
	const submission = parse<SignupForm>(formData);

	try {
		switch (submission.type) {
			// The type will be `submit` by default
			case 'submit':
			// The type will be `validate` on validation
			case 'validate':
				if (!submission.value.email) {
					submission.error.push(['email', 'Email is required']);
				} else if (!submission.value.email.includes('@')) {
					submission.error.push(['email', 'Email is invalid']);
				}

				if (!submission.value.password) {
					submission.error.push(['password', 'Password is required']);
				}

				if (!submission.value.confirmPassword) {
					submission.error.push([
						'confirmPassword',
						'Confirm password is required',
					]);
				} else if (
					submission.value.confirmPassword !== submission.value.password
				) {
					submission.error.push(['confirmPassword', 'Password does not match']);
				}

				/**
				 * Signup only when the user click on the submit button
				 * and no error found
				 */
				if (submission.type === 'submit' && !hasError(submission.error)) {
					throw new Error('Not implemented');
				}

				break;
		}
	} catch (error) {
		/**
		 * By specifying the key as '', the message will be
		 * treated as a form-level error and populated
		 * on the client side as `form.error`
		 */
		submission.error.push(['', 'Oops! Something went wrong.']);
	}

	// Always sends the submission state back to client until the user is signed up
	return json({
		...submission,
		value: {
			// Never send the password back to client
			email: submission.value.email,
		},
	});
}

export default function Signup() {
	// Last submission returned by the server
	const state = useActionData<typeof action>();
	const [form, { email, password, confirmPassword }] = useForm<SignupForm>({
		// Enable server validation mode
		mode: 'server-validation',

		// Begin validating on blur
		initialReport: 'onBlur',

		// Sync the result of last submission
		state,
	});

	return (
		<Form method="post" {...form.props}>
			<div>{form.error}</div>
			<div>
				<label>Email</label>
				<input
					className={email.error ? 'error' : ''}
					{...conform.input(email.config)}
				/>
				<div>{email.error}</div>
			</div>
			<div>
				<label>Password</label>
				<input
					className={password.error ? 'error' : ''}
					{...conform.input(password.config, { type: 'password' })}
				/>
				<div>{password.error}</div>
			</div>
			<div>
				<label>Confirm Password</label>
				<input
					className={confirmPassword.error ? 'error' : ''}
					{...conform.input(confirmPassword.config, { type: 'password' })}
				/>
				<div>{confirmPassword.error}</div>
			</div>
			<button type="submit">Signup</button>
		</Form>
	);
}