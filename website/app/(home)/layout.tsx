import type { ReactNode } from 'react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '../layout.config.js';

export default function Layout({ children }: { children: ReactNode }): React.JSX.Element {
	return <HomeLayout {...baseOptions}>{children}</HomeLayout>;
}
