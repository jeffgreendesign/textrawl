import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { ReactNode } from 'react';
import { baseOptions } from '@/app/layout.config';

type HomeLayoutProps = {
	children: ReactNode;
};

export default function Layout({ children }: HomeLayoutProps): ReactNode {
	return <HomeLayout {...baseOptions}>{children}</HomeLayout>;
}
