import { source } from '@/lib/source';
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

type PageProps = {
	params: Promise<{ slug?: string[] }>;
};

export default async function Page({ params }: PageProps): Promise<ReactNode> {
	const { slug } = await params;
	const page = source.getPage(slug);
	if (!page) notFound();

	const MDX = page.data.body;

	return (
		<DocsPage toc={page.data.toc} full={page.data.full}>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<DocsBody>
				<MDX components={{ ...defaultMdxComponents }} />
			</DocsBody>
		</DocsPage>
	);
}

export function generateStaticParams(): { slug: string[] }[] {
	return source.getPages().map((page: { slugs: string[] }) => ({
		slug: page.slugs,
	}));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const page = source.getPage(slug);
	if (!page) notFound();

	return {
		title: page.data.title,
		description: page.data.description,
	};
}
