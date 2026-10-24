module.exports = {
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  extends: [
    "eslint:recommended",
    "prettier"
  ],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  rules: {
    "no-console": "warn",
    "no-alert": "warn",
    "eqeqeq": ["error", "smart"],
    "curly": ["error", "multi-line"],
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "no-empty": ["error", { "allowEmptyCatch": true }]
  },
  ignorePatterns: ["node_modules/", "reference/", "NGC_NGR/", "docs/assets/", "examples/generated/", "src/physical-connectors.js"]
};