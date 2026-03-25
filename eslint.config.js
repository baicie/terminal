import { antfu } from '@antfu/eslint-config'

export default antfu(
  {
    vue: true,
    react: true,
    typescript: true,
    yaml: false,
    markdown: false,
    stylistic: false,
  },
  {
    ignores: [
      'src-tauri/**',
      'team-server/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.agents/**',
      'skills-lock.json',
    ],
  },
  {
    rules: {
      'ts/no-use-before-define': 'off',
      'ts/no-explicit-any': 'off',
      'ts/consistent-type-imports': 'off',
      'ts/ban-ts-comment': 'warn',
      'ts/no-redeclare': 'off',
      'node/prefer-global/process': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-web-api/no-leaked-timeout': 'warn',
      'react-refresh/only-export-components': 'warn',
      'no-console': 'warn',
      'no-case-declarations': 'off',
      'e18e/prefer-static-regex': 'off',
      'no-alert': 'warn',
      'no-cond-assign': 'warn',
      'unused-imports/no-unused-vars': 'warn',
      'jsdoc/check-param-names': 'off',
      'import/no-duplicates': 'error',
      'unicorn/prefer-number-properties': 'warn',
    },
  },
)
