import type { Config } from 'tailwindcss';

export default {
	content: [
		'./app/**/*.{ts,tsx}',
		'./components/**/*.{ts,tsx}',
		'../docs/**/*.mdx',
		'./node_modules/fumadocs-ui/dist/**/*.js',
	],
	darkMode: 'class',
	theme: {
		extend: {
			fontFamily: {
				display: ['var(--font-display)'],
				sans: ['var(--font-sans)'],
				mono: ['var(--font-mono)'],
			},
			colors: {
				brand: {
					lime: '#c8ff00',
					'lime-dim': '#a3cc00',
					dark: '#0a0a0a',
				},
			},
		},
	},
} satisfies Config;
