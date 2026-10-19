// Assemble le jeu en un seul fichier HTML autonome (dist/frontline.html) : CSS et modules JS inclus.
// Les modules sont concaténés dans une seule portée : deux déclarations du même nom au premier niveau la cassent.
// --check : n'écrit rien, vérifie seulement que tous les modules y sont et que le script assemblé se compile (utilisé
// par les tests).
import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ORDER = ['rng', 'hex', 'names', 'conditions', 'frontmetro', 'terrain', 'metrogen', 'mapgen', 'urbangen', 'units', 'path', 'frontworks', 'frontarmor', 'frontsupply', 'frontnight', 'combat', 'game', 'ai', 'campaign', 'fx', 'audio', 'weather', 'render', 'frontguns', 'frontair', 'frontairwar', 'frontdeck', 'frontscore', 'frontscenario', 'frontbattalion', 'fronthq', 'frontspecial', 'frontatout', 'front', 'frontalert', 'frontstreet', 'frontai', 'frontinput', 'frontfx', 'frontsprites', 'frontinfantry', 'frontcity', 'frontrender', 'frontui', 'main'];
// Hors du fichier unique : l'aperçu du front (outil de développement, sa propre page).
const DEV_ONLY = ['frontpreview'];
const root = new URL('..', import.meta.url).pathname;

// Un module oublié dans ORDER casserait le fichier unique à l'exécution seulement (nom indéfini) : on refuse.
const missing = (await readdir(`${root}src`)).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).filter((m) => !ORDER.includes(m) && !DEV_ONLY.includes(m));
if (missing.length) { console.error(`Modules absents de ORDER (tools/bundle.mjs) : ${missing.join(', ')}`); process.exit(1); }

let js = '';
for (const name of ORDER) {
  const src = await readFile(`${root}src/${name}.js`, 'utf8');
  js += `\n// ===== ${name}.js =====\n` + src
    // Imports sur une ou plusieurs lignes : retirés (une seule portée) ; un import renommé devient une affectation.
    .replace(/^import\s[^;]*;[ \t]*$/gm, (imp) => [...imp.matchAll(/(\w+)\s+as\s+(\w+)/g)].map(([, a, b]) => `const ${b} = ${a};`).join('\n'))
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
// Icônes en ligne : le fichier unique doit garder son icône hors ligne, ajouté à l'écran d'accueil.
const svgIcon = (await readFile(`${root}icons/icon.svg`)).toString('base64');
const touchIcon = (await readFile(`${root}icons/apple-touch-icon.png`)).toString('base64');
const icons = `<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Frontline">\n<link rel="icon" href="data:image/svg+xml;base64,${svgIcon}" type="image/svg+xml">\n<link rel="apple-touch-icon" href="data:image/png;base64,${touchIcon}">\n`;
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/)[0];
const app = html.slice(html.indexOf('<!--APP-->') + 10, html.indexOf('<!--/APP-->'));
const fragment = process.argv.includes('--fragment');
const body = `<title>Frontline</title>\n${fonts}\n<style>\n${css}\n</style>\n${app}\n<script type="module">\n${js}\n</script>\n`;
const out = fragment ? body : `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${icons}${body.replace('</style>\n', '</style>\n</head>\n<body>\n')}</body>\n</html>\n`;
await mkdir(`${root}dist`, { recursive: true });
const file = `${root}dist/${fragment ? 'frontline.fragment.html' : 'frontline.html'}`;
await writeFile(file, out);
console.log(`${file} (${(out.length / 1024).toFixed(0)} Ko)`);
