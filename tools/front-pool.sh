#!/bin/sh
# Trois séries de batailles IA contre IA en parallèle, mises en commun : sh tools/front-pool.sh [batailles par série=40]
# Les réglages passent par l'environnement (SETUP, RULES, AI, SCORE), comme pour tools/front-sim.mjs.
N=${1:-40}
cd "$(dirname "$0")/.."
for s in ${POOL:-poolA poolB poolC}; do JSON=1 node tools/front-sim.mjs "$N" "$s" & done | node -e '
let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => {
  const t = buf.trim().split("\n").map((l) => JSON.parse(l)).reduce((a, b) => { for (const k in b) a[k] = (a[k] ?? 0) + b[k]; return a; }, {});
  const p = (x) => Math.round((100 * x) / t.n) + " %";
  console.log(`${t.n} batailles · attaquant ${p(t.att)} · défenseur ${p(t.def)} · nuls ${p(t.nul)} · Wehrmacht ${p(t.DE)} · Armée rouge ${p(t.SU)} · ${(t.days / t.n).toFixed(1)} jours · ${p(t.early)} avant le terme · ${(t.pockets / t.n).toFixed(1)} encerclements · ${(t.towns / t.n).toFixed(1)} villes prises · Wehrmacht en attaque ${Math.round(100 * t.deAttWin / t.deAtt)} %, en défense ${Math.round(100 * t.deDefWin / (t.n - t.deAtt))} %`);
});'
