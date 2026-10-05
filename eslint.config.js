// Prüfregeln für Server, Oberfläche und Skripte (npm run lint).
// Bewusst schlank: Fehler und riskante Muster melden, keine reinen Stilfragen.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', 'web/dist/**', 'data/**', 'release/**', 'e2e/.data/**', 'e2e/reports/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.ts', 'scripts/**/*.mjs', 'plugins/**/*.{ts,js}', 'e2e/**/*.{ts,mjs}', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright-Fixtures verlangen das leere Objektmuster ({}, use)
    files: ['e2e/**/*.ts'],
    rules: { 'no-empty-pattern': 'off' },
  },
  {
    files: ['web/src/**/*.{ts,tsx}', 'plugins/**/client.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-control-regex': 'off',
    },
  },
);
