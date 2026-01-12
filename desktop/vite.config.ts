import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [preact()],
	root: resolve(__dirname, 'src/renderer'),
	base: './',
	build: {
		outDir: resolve(__dirname, 'dist/renderer'),
		emptyOutDir: true,
		rollupOptions: {
			input: resolve(__dirname, 'src/renderer/index.html'),
		},
	},
	resolve: {
		alias: {
			'@shared': resolve(__dirname, 'src/shared'),
		},
	},
});
