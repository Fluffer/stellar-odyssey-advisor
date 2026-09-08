// i18n-scan.js — find which catalogue keys the GUI actually asks for.
//
// public/app.js builds HTML by string concatenation, so a mistyped key does
// not throw: t() returns the key itself and the raw key text lands on the
// page, where it is easy to miss. check-page.js and test/i18n.test.js both
// use this to fail instead. Shared from lib/ so the two never drift apart.
//
// Keys are found by looking for quoted string literals whose first segment is
// a namespace the catalogue defines, rather than by matching t( call sites:
// the GUI also reaches keys through ternaries (t(x ? 'a.b' : 'a.c')), through
// lookup tables (SKILL_LABELS maps a skill id to a key), and through
// data-i18n attributes in index.html. Matching the literal covers all of them.
"use strict";

// A partial key ending in "." or "_" is a prefix the code concatenates onto
// ("act." + a). Those cannot be resolved statically, so they are reported
// separately and checked for having at least one catalogue key behind them.
const KEYISH = /['"]([A-Za-z][\w]*\.[\w.]*)['"]/g;
const ATTR = /data-i18n(?:-html|-title)?="([\w.]+)"/g;

function scan(sources, catalogue) {
  const namespaces = new Set(Object.keys(catalogue).map(k => k.split(".")[0]));
  const used = new Set();
  const prefixes = new Set();
  const text = Array.isArray(sources) ? sources.join("\n") : String(sources);

  for (const m of text.matchAll(KEYISH)) {
    const key = m[1];
    if (!namespaces.has(key.split(".")[0])) continue; // not one of ours
    if (/[._]$/.test(key)) prefixes.add(key);
    else used.add(key);
  }
  for (const m of text.matchAll(ATTR)) used.add(m[1]);

  const unknown = [...used].filter(k => catalogue[k] === undefined).sort();
  const emptyPrefixes = [...prefixes]
    .filter(p => !Object.keys(catalogue).some(k => k.startsWith(p))).sort();
  const unused = Object.keys(catalogue)
    .filter(k => !used.has(k) && ![...prefixes].some(p => k.startsWith(p))).sort();

  return { used, prefixes, unknown, emptyPrefixes, unused };
}

module.exports = { scan };
