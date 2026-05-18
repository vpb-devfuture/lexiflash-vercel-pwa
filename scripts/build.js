// scripts/build.js
// Dependency-free build for Vercel: copies the static app into dist/.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const include = [
  'index.html',
  'settings.html',
  'manifest.webmanifest',
  'lib',
  'popup',
  'options',
  'icons'
];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const item of include) {
  const src = path.join(root, item);
  const dst = path.join(dist, item);
  fs.cpSync(src, dst, { recursive: true });
}

console.log('LexiFlash static build created at dist/');
