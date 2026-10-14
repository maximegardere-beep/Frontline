// Assemble le jeu en un seul fichier HTML autonome (dist/frontline.html) : CSS et modules JS inclus.
// Les modules sont concaténés dans une seule portée : deux déclarations du même nom au premier niveau la cassent.
// --check : n'écrit rien, vérifie seulement que le script assemblé se compile (utilisé par les tests).
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ORDER = ['rng', 'hex', 'names', 'conditions', 'terrain', 'mapgen', 'units', 'path', 'frontworks', 'frontarmor', 'frontsupply', 'combat', 'game', 'ai', 'campaign', 'fx', 'audio', 'weather', 'render', 'frontguns', 'frontscore', 'front', 'frontai', 'frontinput', 'frontfx', 'frontsprites', 'frontrender', 'frontui', 'main'];
const root = new URL('..', import.meta.url).pathname;

let js = '';
for (const name of ORDER) {
  const src = await readFile(`${root}src/${name}.js`, 'utf8');
  js += `\n// ===== ${name}.js =====\n` + src
    .replace(/^import\s[^;]*;[ \t]*$/gm, '') // imports sur une ou plusieurs lignes
    .replace(/^export \{[^}]*\};?\s*$/gm, '')
    .replace(/^export (?=(const|function|class|let) )/gm, '');
}
js = js.replace("await import('/src/ai.js')", '({ planSide })');

if (process.argv.includes('--check')) {
  const file = `${await mkdtemp(`${tmpdir()}/frontline-`)}/bundle.mjs`;
  await writeFile(file, js);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  console.log('bundle ok');
  process.exit(0);
}

const html = await readFile(`${root}index.html`, 'utf8');
const css = await readFile(`${root}style.css`, 'utf8');
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/)[0];
const app = html.slice(html.indexOf('<!--APP-->') + 10, html.indexOf('<!--/APP-->'));
const fragment = process.argv.includes('--fragment');
const body = `<title>Frontline</title>\n${fonts}\n<style>\n${css}\n</style>\n${app}\n<script type="module">\n${js}\n</script>\n`;
const out = fragment ? body : `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${body.replace('</style>\n', '</style>\n</head>\n<body>\n')}</body>\n</html>\n`;
await mkdir(`${root}dist`, { recursive: true });
const file = `${root}dist/${fragment ? 'frontline.fragment.html' : 'frontline.html'}`;
await writeFile(file, out);
console.log(`${file} (${(out.length / 1024).toFixed(0)} Ko)`);
