import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'vendor/**',
      'fixtures/**',
    ],
  },
  {
    files: [
      'electron/**/*.js',
      'scripts/**/*.js',
      'tests/electron/**/*.js',
      'shared/**/*.mjs',
      'src/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
    },
    rules: {
      ...js.configs.recommended.rules,
      // Runtime globals vary between Node.js, Electron and browser-shared modules;
      // TypeScript checks the selected backend and the renderer separately.
      'no-undef': 'off',
      // Existing JavaScript includes intentionally unused compatibility arguments.
      // Keep the first lint pass focused on correctness rather than mass refactors.
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Control-character checks are deliberate in input sanitizers.
      'no-control-regex': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['electron/**/*.js', 'scripts/**/*.js', 'tests/electron/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
];
