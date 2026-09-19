const js = require("@eslint/js");

const BROWSER_GLOBALS = {
  window: "readonly",
  document: "readonly",
  localStorage: "readonly",
  fetch: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  navigator: "readonly",
  AbortController: "readonly",
};

const EXTENSION_GLOBALS = {
  ...BROWSER_GLOBALS,
  chrome: "readonly",
};

const NODE_GLOBALS = {
  require: "readonly",
  module: "readonly",
  exports: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  process: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  Buffer: "readonly",
  WebSocket: "readonly",
  URL: "readonly",
};

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: NODE_GLOBALS,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "preserve-caught-error": "off",
      "no-useless-escape": "off",
    },
  },
  {
    files: ["bridge-extension/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: EXTENSION_GLOBALS,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...BROWSER_GLOBALS,
        URL: "readonly",
        t: "writable",
        I18n: "writable",
        LANGS: "writable",
        LANG_NAMES: "writable",
        PetMath: "writable",
        LabMath: "writable",
        BaseMath: "writable",
        UnitMath: "writable",
        VoyagerMath: "writable",
        CraftMath: "writable",
        IconMap: "writable",
        renderTabs: "writable",
        fmtK: "writable",
        fmtPct: "writable",
        barPct: "writable",
        loadLast: "writable",
        loadHistory: "writable",
        analyze: "writable",
        setAutoRefresh: "writable",
        refreshState: "writable",
        toggleDone: "writable",
        resetDone: "writable",
        sortTable: "writable",
        setUnitEmuAll: "writable",
        bumpUnitEmu: "writable",
        maxUnitEmu: "writable",
        resetUnitEmu: "writable",
        setInvFilter: "writable",
        craftUseStock: "writable",
        setLabCapsules: "writable",
        setLabEmu: "writable",
        setLabEmuLevel: "writable",
        setLabEmuSpeed: "writable",
        labEmuAllFloor: "writable",
        bumpLabEmu: "writable",
        spendLabEmu: "writable",
        resetLabEmu: "writable",
        setBaseLevel: "writable",
        bumpBaseQcEmu: "writable",
        resetBaseQcEmu: "writable",
        maxVoyPlan: "writable",
        resetVoyPlan: "writable",
        setAutoMins: "writable",
        toggleAuto: "writable",
        setTab: "writable",
        setVariant: "writable",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-redeclare": "off",
    },
  },
  // public/app.js declares its GUI handlers as top-level functions that the
  // page wires up through onclick="..." strings inside dynamically generated
  // HTML -- invisible to static analysis, so no-unused-vars fires on every
  // one of them. Dead handlers are enforced for real by the dead-handler
  // check in check-page.js (run via npm run check), so the rule is turned
  // off for app.js only and every other rule stays as it is.
  {
    files: ["public/app.js"],
    rules: {
      "no-unused-vars": "off",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
  },
  {
    ignores: ["bridge-extension/page.js", "snapshots/**", "*.log", "node_modules/**"],
  },
];
