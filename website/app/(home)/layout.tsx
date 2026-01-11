import type { ReactNode } from 'react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '../layout.config.js';

type HomeLayoutProps = {
	children: ReactNode;
};

export default function Layout({ children }: HomeLayoutProps): ReactNode {
	return <HomeLayout {...baseOptions}>{children}</HomeLayout>;
}
