import path from 'node:path';
import babel from '@rollup/plugin-babel';
import nodeResolve from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';

/** @returns {import("rollup").RollupOptions[]} */
function configurePackage(name, experimental = false) {
	let sourceDir = `packages/${name}`;
	let outputDir = `${sourceDir}`;

	/** @type {import("rollup").RollupOptions} */
	let ESM = {
		external(id) {
			return !id.startsWith('.') && !path.isAbsolute(id);
		},
		input: experimental ? [
			`${sourceDir}/index.ts`,
			`${sourceDir}/experimental/index.ts`
		]: `${sourceDir}/index.ts`,
		output: {
			dir: outputDir,
			format: 'esm',
			preserveModules: true,
			entryFileNames: '[name].mjs',
		},
		plugins: [
			babel({
				babelHelpers: 'bundled',
				exclude: /node_modules/,
				extensions: ['.ts', '.tsx'],
			}),
			nodeResolve({
				extensions: ['.ts', '.tsx'],
			}),
			!name.endsWith('experimental') ?
			copy({
				targets: [{ src: `LICENSE`, dest: sourceDir }],
			}) : null,
		],
	};

	/** @type {import("rollup").RollupOptions} */
	let CJS = {
		external(id) {
			return !id.startsWith('.') && !path.isAbsolute(id);
		},
		input: experimental ? [
			`${sourceDir}/index.ts`,
			`${sourceDir}/experimental/index.ts`
		]: `${sourceDir}/index.ts`,
		output: {
			dir: outputDir,
			format: 'cjs',
			preserveModules: true,
			exports: 'auto',
		},
		plugins: [
			babel({
				babelHelpers: 'bundled',
				exclude: /node_modules/,
				extensions: ['.ts', '.tsx'],
			}),
			nodeResolve({
				extensions: ['.ts', '.tsx'],
			}),
		],
	};

	return [ESM, CJS];
}

export default function rollup() {
	return [
		// Base
		...configurePackage('conform-dom', true),
		...configurePackage('conform-validitystate'),

		// Schema resolver
		...configurePackage('conform-zod', true),
		...configurePackage('conform-yup'),

		// View adapter
		...configurePackage('conform-react', true),
	];
}
