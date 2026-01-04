'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

export function ThemeToggle(): ReactNode {
	const { theme, setTheme } = useTheme();

	const toggleTheme = (): void => {
		setTheme(theme === 'dark' ? 'light' : 'dark');
	};

	return (
		<button
			type="button"
			onClick={toggleTheme}
			className="theme-toggle"
			aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
		>
			{theme === 'dark' ? (
				<Sun size={18} strokeWidth={1.5} />
			) : (
				<Moon size={18} strokeWidth={1.5} />
			)}
		</button>
	);
}
