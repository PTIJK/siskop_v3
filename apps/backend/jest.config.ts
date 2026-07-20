import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@siskop/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^puppeteer$': '<rootDir>/__mocks__/puppeteer.js',
  },
  // Runs in the SAME V8 context as tests — env vars are visible to all modules
  setupFiles: ['<rootDir>/tests/env.ts'],
  globalTeardown: '<rootDir>/tests/teardown.ts',
  testTimeout: 30000,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};

export default config;
