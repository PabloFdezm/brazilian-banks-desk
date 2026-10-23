/* Build assets/breaks.js from assets/breaks.json.
   The desk loads JS, not JSON, so the register also works from file://.
   Run: node tools/build-breaks.js */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const json = fs.readFileSync(path.join(root, 'assets/breaks.json'), 'utf8');
JSON.parse(json); // fail loudly on a malformed register
const out = '/* GENERATED from assets/breaks.json by tools/build-breaks.js — do not edit. */\n'
  + 'window.FARO_BREAKS = ' + json.trim() + ';\n';
fs.writeFileSync(path.join(root, 'assets/breaks.js'), out);
console.log('assets/breaks.js written · ' + json.length + ' bytes');
