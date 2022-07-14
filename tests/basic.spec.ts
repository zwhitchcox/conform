import { test, expect } from '@playwright/test';
import {
	getPlaygroundLocator,
	getConstraint,
	clickSubmitButton,
	getErrorMessages,
	getValidationMessage,
	getFormResult,
	isTouched,
	clickResetButton,
} from './helpers';

test.beforeEach(async ({ page }) => {
	await page.goto('/basic');
});

test.describe('Native Constraint', () => {
	test('configure all input fields correctly', async ({ page }) => {
		const playground = getPlaygroundLocator(page, 'Native Constraint');
		const [email, password, age] = await Promise.all([
			getConstraint(playground.locator('[name="email"]')),
			getConstraint(playground.locator('[name="password"]')),
			getConstraint(playground.locator('[name="age"]')),
		]);

		expect({ email, password, age }).toEqual({
			email: {
				required: true,
				minLength: -1,
				maxLength: -1,
				min: '',
				max: '',
				step: '',
				multiple: true,
				pattern: '',
			},
			password: {
				required: true,
				minLength: 8,
				maxLength: 20,
				min: '',
				max: '',
				step: '',
				multiple: false,
				pattern: '[0-9a-zA-Z]{8,20}',
			},
			age: {
				required: false,
				minLength: -1,
				maxLength: -1,
				min: '1',
				max: '100',
				step: '10',
				multiple: false,
				pattern: '',
			},
		});
	});

	test('report error message provided by the browser vendor', async ({
		page,
	}) => {
		const playground = getPlaygroundLocator(page, 'Native Constraint');
		const email = playground.locator('[name="email"]');
		const password = playground.locator('[name="password"]');
		const age = playground.locator('[name="age"]');

		await clickSubmitButton(playground);

		expect(await getErrorMessages(playground)).toEqual(
			await Promise.all([
				getValidationMessage(email),
				getValidationMessage(password),
				getValidationMessage(age),
			]),
		);

		await email.type('me@edmund.dev');
		expect(await getErrorMessages(playground)).toEqual(
			await Promise.all([
				'',
				getValidationMessage(password),
				getValidationMessage(age),
			]),
		);

		await password.type('conform!');
		expect(await getErrorMessages(playground)).toEqual(
			await Promise.all([
				'',
				getValidationMessage(password),
				getValidationMessage(age),
			]),
		);

		await password.fill('');
		await password.type('constraintvalidation');
		expect(await getErrorMessages(playground)).toEqual(
			await Promise.all(['', '', getValidationMessage(age)]),
		);

		await age.type('9');
		expect(await getErrorMessages(playground)).toEqual(
			await Promise.all(['', '', getValidationMessage(age)]),
		);

		await age.type('1'); // 9 -> 91
		expect(await getErrorMessages(playground)).toEqual(['', '', '']);

		await clickSubmitButton(playground);
		expect(await getFormResult(playground)).toEqual({
			state: 'accepted',
			value: {
				email: 'me@edmund.dev',
				password: 'constraintvalidation',
				age: '91',
			},
		});
	});
});

test.describe('Custom Constraint', () => {
	test('report error messages correctly', async ({ page }) => {
		const playground = getPlaygroundLocator(page, 'Custom Constraint');
		const number = playground.locator('[name="number"]');
		const accept = playground.locator('[name="accept"]');

		await clickSubmitButton(playground);

		expect(await getErrorMessages(playground)).toEqual([
			'Number is required',
			'Please accept before submit',
		]);

		await number.type('0');
		expect(await getErrorMessages(playground)).toEqual([
			'Number must be between 1 and 10',
			'Please accept before submit',
		]);

		await number.fill('');
		await number.type('5');
		expect(await getErrorMessages(playground)).toEqual([
			'Are you sure?',
			'Please accept before submit',
		]);

		await number.fill('');
		await number.type('10');
		expect(await getErrorMessages(playground)).toEqual([
			'',
			'Please accept before submit',
		]);

		await accept.check();
		expect(await getErrorMessages(playground)).toEqual(['', '']);

		await clickSubmitButton(playground);
		expect(await getFormResult(playground)).toEqual({
			state: 'accepted',
			value: {
				number: '10',
				accept: 'on',
			},
		});
	});

	test('clear error messages, touched state and reset validity on reset', async ({
		page,
	}) => {
		const playground = getPlaygroundLocator(page, 'Custom Constraint');
		const number = playground.locator('[name="number"]');
		const accept = playground.locator('[name="accept"]');

		const initialValidationMessages = [
			'Number is required',
			'Please accept before submit',
		];

		await clickSubmitButton(playground);

		expect(
			await Promise.all([isTouched(number), isTouched(accept)]),
		).not.toContain(false);
		expect(await getErrorMessages(playground)).toEqual(
			initialValidationMessages,
		);

		await number.type('5');

		expect(await getErrorMessages(playground)).not.toEqual(
			initialValidationMessages,
		);

		await clickResetButton(playground);

		expect(await getErrorMessages(playground)).toEqual(['', '']);
		expect(
			await Promise.all([
				getValidationMessage(number),
				getValidationMessage(accept),
			]),
		).toEqual(initialValidationMessages);
		expect(
			await Promise.all([isTouched(number), isTouched(accept)]),
		).not.toContain(true);
	});
});