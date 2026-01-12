#!/usr/bin/env node
/**
 * Favicon generation script
 * Converts SVG to multiple PNG sizes for full favicon support
 */

import sharp from 'sharp';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '../website/public');
const svgPath = join(publicDir, 'icon.svg');

const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'android-chrome-192x192.png', size: 192 },
  { name: 'android-chrome-512x512.png', size: 512 },
];

async function generateFavicons() {
  console.error('Reading SVG from:', svgPath);

  if (!existsSync(svgPath)) {
    throw new Error(
      `SVG source not found: ${svgPath}\nPlease create website/public/icon.svg first.`
    );
  }

  const svgBuffer = readFileSync(svgPath);

  for (const { name, size } of sizes) {
    const outputPath = join(publicDir, name);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.error(`Generated: ${name} (${size}x${size})`);
  }

  console.error('\nAll favicons generated successfully!');
}

generateFavicons().catch((err) => {
  console.error('Error generating favicons:', err);
  process.exit(1);
});
