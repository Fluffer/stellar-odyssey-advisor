// Behaviour locks for public/i18n.js — the GUI's English/Chinese catalogue.
//
// The advisor builds its HTML by string concatenation, so a mistyped key does
// not throw: it renders the raw key text onto the page, where it is easy to
// miss. These tests fail instead.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const I18n = require("../public/i18n.js");

const { scan } = require("../lib/i18n-scan.js");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const SOURCES = ["app.js", "index.html"]
  .map(f => fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8"));

const placeholders = s => (String(s).match(/\{\w+\}/g) || []).sort().join(",");

describe("catalogue coverage", () => {
  test("every key the GUI uses exists in English", () => {
    assert.deepEqual(scan(SOURCES, I18n.CATALOG.en).unknown, [], "keys used but never defined");
  });

  test("every key prefix the code concatenates onto has entries behind it", () => {
    // e.g. t('act.' + activity) — a static scan cannot resolve the whole key,
    // but an empty prefix means the whole family is missing.
    assert.deepEqual(scan(SOURCES, I18n.CATALOG.en).emptyPrefixes, [], "prefixes with no keys");
  });

  test("every English key is translated to Chinese", () => {
    assert.deepEqual(I18n.missing("zh"), [], "untranslated keys");
  });

  test("Chinese defines nothing English does not", () => {
    // A stale zh key means an English string was renamed and its translation
    // was left behind, which no fallback can surface.
    assert.deepEqual(I18n.extra("zh"), [], "stale Chinese keys");
  });

  test("the catalogue is not trivially small", () => {
    // Guards against a merge that drops a whole region's keys.
    assert.ok(Object.keys(I18n.CATALOG.en).length > 100,
      "only " + Object.keys(I18n.CATALOG.en).length + " keys");
  });
});

describe("translation shape", () => {
  test("both languages carry the same placeholders for a key", () => {
    const bad = Object.keys(I18n.CATALOG.en).filter(
      k => placeholders(I18n.CATALOG.en[k]) !== placeholders(I18n.CATALOG.zh[k]));
    assert.deepEqual(bad, [], "placeholder mismatch: a {var} would render literally");
  });

  test("no Chinese string is left as its English original", () => {
    // Purely-symbolic strings (numbers, punctuation, entity-only) legitimately
    // match; anything with Latin letters that is byte-identical was skipped.
    const same = Object.keys(I18n.CATALOG.en).filter(k =>
      I18n.CATALOG.en[k] === I18n.CATALOG.zh[k] && /[A-Za-z]{4}/.test(I18n.CATALOG.en[k]));
    assert.deepEqual(same, [], "identical to the English text");
  });
});

describe("t()", () => {
  test("returns the current language and falls back to English", () => {
    I18n.lang = "en";
    assert.equal(I18n.t("common.total"), "Total");
    I18n.lang = "zh";
    assert.equal(I18n.t("common.total"), "合计");
    // A language whose table has no entry for a key still renders English.
    I18n.CATALOG.zh.__probe = undefined;
    I18n.CATALOG.en.__probe = "English only";
    assert.equal(I18n.t("__probe"), "English only");
    delete I18n.CATALOG.en.__probe;
    delete I18n.CATALOG.zh.__probe;
    I18n.lang = "en";
  });

  test("an unknown key renders as the key, never as undefined", () => {
    assert.equal(I18n.t("no.such.key"), "no.such.key");
  });

  test("substitutes {placeholders} and leaves unknown ones alone", () => {
    I18n.CATALOG.en.__p = "have {n} of {m}";
    assert.equal(I18n.t("__p", { n: 3, m: 7 }), "have 3 of 7");
    assert.equal(I18n.t("__p", { n: 3 }), "have 3 of {m}");
    assert.equal(I18n.t("__p"), "have {n} of {m}");
    delete I18n.CATALOG.en.__p;
  });

  test("setLang refuses a language with no catalogue", () => {
    I18n.lang = "en";
    assert.equal(I18n.setLang("de"), "en");
    assert.equal(I18n.lang, "en");
  });
});
