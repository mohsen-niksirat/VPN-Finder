// Syncs root Mini App files and vendored assets into serverless/dist/
// so `tgcloud push` can deploy the Mini App alongside the serverless endpoints.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'serverless', 'dist');

const FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'pvl-snapshot.json',
  'assets/qrcode.js',
];

for (const file of FILES) {
  const src = path.join(ROOT, file);
  const dst = path.join(DIST, file);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
console.log(`Synced ${FILES.length} files to serverless/dist/`);
