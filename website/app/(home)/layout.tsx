import { baseOptions } from '@/app/layout.config';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { ReactNode } from 'react';

type HomeLayoutProps = {
	children: ReactNode;
};

export default function Layout({ children }: HomeLayoutProps): ReactNode {
	return <HomeLayout {...baseOptions}>{children}</HomeLayout>;
}
