import { antfu } from '@antfu/eslint-config'

export default antfu(
  {
    vue: false,
    react: false,
    typescript: true,
    yaml: false,
    markdown: false,
    test: false,
    stylistic: false,
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
    rules: {
      'ts/no-explicit-any': 'off',
      'ts/consistent-type-imports': 'off',
      'no-console': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'node/prefer-global/process': 'off',
    },
  },
)
