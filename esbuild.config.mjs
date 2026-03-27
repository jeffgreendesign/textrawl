import * as esbuild from 'esbuild';

await esbuild.build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	outfile: 'dist/index.js',
	minify: true,
	sourcemap: true,
	packages: 'external',
});

console.error('Build complete: dist/index.js');
