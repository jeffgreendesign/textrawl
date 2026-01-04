import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const svgContent = readFileSync(join(publicDir, 'favicon.svg'), 'utf-8');
const svgBuffer = Buffer.from(svgContent);

const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'android-chrome-192x192.png', size: 192 },
  { name: 'android-chrome-512x512.png', size: 512 },
];

// OG image SVG template (1200x630)
const ogImageSvg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#0a0a0f"/>
  <defs>
    <linearGradient id="og-gradient" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6366f1" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#8b5cf6" stop-opacity="0.05"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#og-gradient)"/>

  <!-- Logo icon -->
  <g transform="translate(500, 180)">
    <rect width="200" height="200" rx="40" fill="url(#logo-grad)"/>
    <path d="M50 62.5H150M50 100H125M50 137.5H100" stroke="white" stroke-width="12" stroke-linecap="round"/>
    <circle cx="150" cy="137.5" r="25" fill="white" fill-opacity="0.9"/>
  </g>
  <defs>
    <linearGradient id="logo-grad" x1="500" y1="180" x2="700" y2="380" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6366f1"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>

  <!-- Text -->
  <text x="600" y="450" font-family="system-ui, -apple-system, sans-serif" font-size="72" font-weight="700" fill="#e2e8f0" text-anchor="middle">Textrawl</text>
  <text x="600" y="520" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="#a5b4fc" text-anchor="middle">Personal Knowledge MCP Server</text>
</svg>
`;

async function generateFavicons() {
  console.error('Generating favicons from SVG...');

  for (const { name, size } of sizes) {
    await sharp(svgBuffer, { density: 300 })
      .resize(size, size)
      .png()
      .toFile(join(publicDir, name));
    console.error(`  Created ${name}`);
  }

  // Generate OG image
  console.error('Generating OG image...');
  await sharp(Buffer.from(ogImageSvg))
    .png()
    .toFile(join(publicDir, 'og-image.png'));
  console.error('  Created og-image.png');

  console.error('Done!');
}

generateFavicons().catch(console.error);
