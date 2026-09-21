// ESLint "flat config". The course materials show the older `.eslintrc.json`
// style; that format was replaced in ESLint 9 and removed entirely in ESLint 10
// (which is what this project installs), so this file is the modern equivalent.
//
// The idea is the same either way: a linter reads the code *without running it*
// and reports things that are legal JavaScript but almost certainly a mistake —
// a variable you declared and never used, a `console.log` left in, a promise you
// forgot to await.
const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  // Files ESLint should never look at. swagger-output.json is generated, and
  // data/*.json is plain fixture data with no code in it.
  {
    ignores: ['node_modules/**', 'swagger-output.json'],
  },

  // Every .js file in the project is Node, CommonJS (`require`), modern syntax.
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      // Tells ESLint that names like `process`, `console`, and `__dirname`
      // exist. Without this it would flag every one of them as undefined.
      globals: globals.node,
    },
    // `js.configs.recommended` is ESLint's own curated rule set — the errors
    // that are almost never intentional.
    extends: [js.configs.recommended],
    rules: {
      // Unused variables are usually a typo or leftover code. The exception:
      // Express error middleware must declare all four parameters `(err, req,
      // res, next)` even when it ignores some, so allow unused *arguments* that
      // are followed by a used one, and any name starting with `_`.
      'no-unused-vars': [
        'error',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // We log deliberately on the server, so console is allowed — but warn on
      // the ones that are usually debugging leftovers.
      'no-console': ['warn', { allow: ['log', 'info', 'warn', 'error'] }],
      // `==` does surprising type coercion ('' == 0 is true). Require `===`.
      eqeqeq: ['error', 'always'],
      // Catch `await` used outside an async function, and promises created in a
      // loop without being awaited.
      'require-atomic-updates': 'error',
      'no-return-await': 'error',
    },
  },

  // MUST be last. This turns OFF every ESLint rule that is purely about
  // formatting (quotes, semicolons, indentation) so ESLint and Prettier never
  // disagree: Prettier owns formatting, ESLint owns correctness.
  prettier,
]);
