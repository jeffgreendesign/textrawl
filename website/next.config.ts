import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const config = {
	reactStrictMode: true,
} satisfies import('next').NextConfig;

export default withMDX(config);
