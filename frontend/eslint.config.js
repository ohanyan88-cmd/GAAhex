// Single-source ESLint config (flat, eslint 9). The RATCHET gate runs this on
// CHANGED/STAGED files only (pre-commit + CI); legacy is grandfathered and cleaned
// via refactor-on-sight. Rules are pragmatic so genuine errors block while the
// codebase's existing `any` / intentional patterns don't. Formatting is owned by
// Prettier (eslint-config-prettier turns the conflicting rules off).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'storybook-static/**',
      '.storybook/**',
      'eslint.config.js',
      '**/*.config.{js,cjs,mjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TypeScript already resolves identifiers; no-undef double-flags browser globals.
      'no-undef': 'off',
      // The codebase intentionally uses `any` at API/data boundaries (typed at the seam later).
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Genuine errors that must block a commit:
      'no-debugger': 'error',
    },
  },
  prettier,
)
