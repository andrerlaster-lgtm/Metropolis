// Bundles src/ into a single self-contained HTML file (dist/pocket-metropolis.html).
// Each module keeps its own scope; imports become destructured reads of the module's exports.
// Usage: node build.mjs (or npm run build)

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+)\.js';\s*$/gm;
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\}\s*;?\s*$/gm;

const modules = new Map();
function load(name) {
  if (modules.has(name)) return;
  modules.set(name, null); // mark in progress
  const code = readFileSync(join(src, `${name}.js`), 'utf8');
  const deps = [...code.matchAll(IMPORT_RE)].map((m) => m[2]);
  for (const d of deps) load(d);
  modules.set(name, code);
  order.push(name);
}
const order = [];
load('main');

const ident = (name) => `__mod_${name.replace(/\W/g, '_')}`;
let bundle = '';
for (const name of order) {
  let code = modules.get(name);
  const exports = [...code.matchAll(EXPORT_DECL_RE)].map((m) => m[1]);
  for (const m of code.matchAll(EXPORT_LIST_RE)) {
    exports.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')));
  }
  code = code.replace(IMPORT_RE, (_, names, dep) => {
    const list = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = ${ident(dep)};`;
  });
  code = code.replace(EXPORT_LIST_RE, '').replace(/^export\s+/gm, '');
  if (/^\s*(import|export)\b/m.test(code)) throw new Error(`Unsupported import/export form in ${name}.js`);
  bundle += `\n// ---- ${name}.js ----\nconst ${ident(name)} = (() => {\n${code}\nreturn { ${exports.join(', ')} };\n})();\n`;
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const body = html.match(/<!-- app:start -->([\s\S]*?)<!-- app:end -->/)[1].trim();
const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts[^"]+)"/)[1];
const css = readFileSync(join(src, 'style.css'), 'utf8');

const out = `<title>Pocket Metropolis</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
${body}
<script>
'use strict';
(() => {${bundle}
})();
</script>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'pocket-metropolis.html'), out);
// Standalone page for static hosting (Vercel, GitHub Pages, …).
const [head, page] = out.split('</style>\n');
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#dcf0f2">
${head}</style>
</head>
<body>
${page}</body>
</html>
`;
writeFileSync(join(root, 'dist', 'index.html'), standalone);

// The 3D view and Three.js load on demand from dist/view3d/, only when someone opens the 3D view.
// They are real ES modules, copied as they are (Three.js is vendored unmodified, MIT licence alongside).
const view3dSrc = join(src, 'view3d');
const view3dOut = join(root, 'dist', 'view3d');
rmSync(view3dOut, { recursive: true, force: true });
cpSync(view3dSrc, view3dOut, { recursive: true });
const view3dKB = readdirSync(view3dOut, { recursive: true })
  .map((f) => join(view3dOut, f))
  .filter((f) => statSync(f).isFile())
  .reduce((n, f) => n + statSync(f).size, 0) / 1024;
console.log(`Bundled ${order.length} modules: ${order.join(' → ')} (${(out.length / 1024).toFixed(1)} KB)`);
console.log(`3D view: dist/view3d/ (${view3dKB.toFixed(1)} KB, loaded only when opened)`);
