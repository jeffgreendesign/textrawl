import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://textrawl.dev',
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    starlight({
      title: 'Textrawl',
      description: 'Personal Knowledge MCP Server - Turn your documents into Claude\'s memory',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: false,
      },
      social: {
        github: 'https://github.com/jeffgreendesign/textrawl',
      },
      editLink: {
        baseUrl: 'https://github.com/jeffgreendesign/textrawl/edit/main/website/src/content/docs/',
      },
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'link',
          attrs: { rel: 'llms', href: '/llms.txt' },
        },
        {
          tag: 'meta',
          attrs: { name: 'theme-color', content: '#6366f1' },
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Configuration', slug: 'getting-started/configuration' },
          ],
        },
        {
          label: 'MCP Tools',
          items: [
            { label: 'Overview', slug: 'mcp-tools/overview' },
            { label: 'search_knowledge', slug: 'mcp-tools/search-knowledge' },
            { label: 'get_document', slug: 'mcp-tools/get-document' },
            { label: 'list_documents', slug: 'mcp-tools/list-documents' },
            { label: 'update_document', slug: 'mcp-tools/update-document' },
            { label: 'add_note', slug: 'mcp-tools/add-note' },
          ],
        },
        {
          label: 'CLI Tools',
          items: [
            { label: 'Overview', slug: 'cli/overview' },
            { label: 'MBOX Conversion', slug: 'cli/mbox-conversion' },
            { label: 'HTML Conversion', slug: 'cli/html-conversion' },
            { label: 'Batch Upload', slug: 'cli/batch-upload' },
          ],
        },
        {
          label: 'Desktop App',
          items: [
            { label: 'Features', slug: 'desktop/features' },
            { label: 'Building', slug: 'desktop/building' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Email Import', slug: 'guides/email-import' },
            { label: 'Search Optimization', slug: 'guides/search-optimization' },
            { label: 'Docker Deployment', slug: 'guides/docker-deployment' },
            { label: 'Cloud Run Deployment', slug: 'guides/cloud-run-deployment' },
            { label: 'Security Hardening', slug: 'guides/security-hardening' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'How Hybrid Search Works', slug: 'architecture/hybrid-search' },
            { label: 'Chunking Strategy', slug: 'architecture/chunking' },
            { label: 'Embedding Providers', slug: 'architecture/embeddings' },
          ],
        },
        {
          label: 'Playground',
          link: '/playground/',
        },
      ],
      components: {
        Head: './src/components/Head.astro',
      },
    }),
  ],
});
