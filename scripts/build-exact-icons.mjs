// One-off icon generator. It needs `sharp`, which is not installed by default (it slows every build):
//   npm i -D sharp && node scripts/build-exact-icons.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Exact vector reproduction matching exact-icon-512.png and exact-icon.svg
// The leaves point UP above the book pages, fully visible with no obstruction
const exactSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="36%" r="65%">
      <stop offset="0%" stop-color="#24452d" />
      <stop offset="55%" stop-color="#193722" />
      <stop offset="100%" stop-color="#102215" />
    </radialGradient>
  </defs>

  <!-- Full-bleed forest green background -->
  <rect width="512" height="512" fill="url(#bg)" />

  <!-- Center sprout emerging upward from book spine -->
  <g id="sprout">
    <!-- Sprout stem -->
    <rect x="248" y="80" width="16" height="85" fill="#8ec495" />

    <!-- Left Leaf pointing up-left above book -->
    <g transform="translate(256, 155) rotate(-42)">
      <ellipse cx="0" cy="-70" rx="34" ry="58" fill="#cae8be" />
    </g>

    <!-- Right Leaf pointing up-right above book -->
    <g transform="translate(256, 155) rotate(42)">
      <ellipse cx="0" cy="-70" rx="34" ry="58" fill="#cae8be" />
    </g>
  </g>

  <!-- Wooden planter tray -->
  <rect x="56" y="160" width="400" height="240" rx="52" fill="#8c5838" />

  <!-- Left page -->
  <g id="left-page">
    <rect x="76" y="138" width="174" height="226" rx="42" fill="#faf6ec" />
    <path d="M 76 328 C 76 348 94 364 118 364 L 226 364 C 242 364 250 354 250 340 L 250 328 Z" fill="#e7d8ba" />
    <rect x="108" y="192" width="112" height="15" rx="7.5" fill="#cebe9f" />
    <rect x="108" y="233" width="112" height="15" rx="7.5" fill="#cebe9f" />
    <rect x="108" y="274" width="112" height="15" rx="7.5" fill="#cebe9f" />
  </g>

  <!-- Right page -->
  <g id="right-page">
    <rect x="262" y="138" width="174" height="226" rx="42" fill="#faf6ec" />
    <path d="M 262 328 L 262 340 C 262 354 270 364 286 364 L 394 364 C 418 364 436 348 436 328 Z" fill="#e7d8ba" />
    <!-- Classic plump pink heart (matching user's exact artwork) -->
    <path
      d="M 349 204
         C 336 182, 308 174, 292 196
         C 274 220, 276 250, 304 276
         C 325 296, 344 306, 349 308
         C 354 306, 373 296, 394 276
         C 422 250, 424 220, 406 196
         C 390 174, 362 182, 349 204 Z"
      fill="#e55077"
    />
    <!-- Circular shine dot on upper left of heart -->
    <circle cx="332" cy="222" r="9" fill="#ffffff" />
  </g>
</svg>`;

async function main() {
  const publicDir = path.resolve('public');
  const distDir = path.resolve('dist');

  // Save SVG
  await fs.writeFile(path.join(publicDir, 'exact-icon.svg'), exactSvg, 'utf8');
  await fs.writeFile(path.join(distDir, 'exact-icon.svg'), exactSvg, 'utf8').catch(() => {});
  console.log('✓ Created exact-icon.svg with upward leaves');

  const svgBuf = Buffer.from(exactSvg);

  // 1. exact-icon-512.png (512x512)
  const p512 = await sharp(svgBuf)
    .resize(512, 512)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(path.join(publicDir, 'exact-icon-512.png'), p512);
  await fs.writeFile(path.join(distDir, 'exact-icon-512.png'), p512).catch(() => {});
  console.log('✓ Created exact-icon-512.png');

  // 2. exact-icon-192.png (192x192)
  const p192 = await sharp(svgBuf)
    .resize(192, 192)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(path.join(publicDir, 'exact-icon-192.png'), p192);
  await fs.writeFile(path.join(distDir, 'exact-icon-192.png'), p192).catch(() => {});
  console.log('✓ Created exact-icon-192.png');

  // 3. exact-apple-touch-icon.png (180x180)
  const p180 = await sharp(svgBuf)
    .resize(180, 180)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(path.join(publicDir, 'exact-apple-touch-icon.png'), p180);
  await fs.writeFile(path.join(distDir, 'exact-apple-touch-icon.png'), p180).catch(() => {});
  console.log('✓ Created exact-apple-touch-icon.png');

  // 4. exact-favicon.png (64x64)
  const p64 = await sharp(svgBuf)
    .resize(64, 64)
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(path.join(publicDir, 'exact-favicon.png'), p64);
  await fs.writeFile(path.join(distDir, 'exact-favicon.png'), p64).catch(() => {});
  console.log('✓ Created exact-favicon.png');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
