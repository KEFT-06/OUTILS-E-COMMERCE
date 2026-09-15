import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Relecture automatique du code (`npm run lint`, zéro avertissement toléré).
 *
 * Règles sans information de type : rapides, et suffisantes à côté de `tsc`
 * en mode strict, qui vérifie déjà les types.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '_legacy/**', '.data/**', 'coverage/**', 'drizzle/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
);
