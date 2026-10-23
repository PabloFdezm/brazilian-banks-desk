#!/usr/bin/env node
/*
  build-site.js — assemble the publishable desk into dist/.

  The desk has no build step for the browser: pages read assets/*.js directly.
  This script exists only so the deploy never includes data/ (91 MB of raw BCB
  downloads), .git/ or the tooling. Everything copied here is what the analyst
  sees; anything else stays in the repo.

  Usage:  node tools/build-site.js
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

/* Everything the browser needs, and nothing else. */
const DIRS = ['assets'];
const EXCLUDE_FILES = new Set([
  'desktop.ini', 'Thumbs.db', '.gitignore', 'README.md', 'DESIGN.md',
  'improvement-pipeline.md'
]);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE_FILES.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let pages = 0;
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
  fs.copyFileSync(path.join(ROOT, entry.name), path.join(OUT, entry.name));
  pages++;
}
for (const dir of DIRS) copyDir(path.join(ROOT, dir), path.join(OUT, dir));

/* Report what ships, and refuse a deploy that accidentally drags data/ in. */
function size(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? size(p) : fs.statSync(p).size;
  }
  return total;
}
const bytes = size(OUT);
if (fs.existsSync(path.join(OUT, 'data'))) {
  console.error('refusing: dist/ contains data/ — the raw downloads must not ship');
  process.exit(1);
}
console.log(`dist/  ${pages} pages  ${(bytes / 1024).toFixed(0)} KB`);
