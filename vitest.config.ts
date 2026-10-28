import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        test: {
          name: 'unit',
          // The proxy refreshes the skill copies in the real home when it
          // starts; a test run must never write there.
          env: { CHAIN_INSIGHTS_SKILL_REFRESH: '0' },
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.integration.test.ts', 'tests/**/*.t2.test.ts'],
        },
      },
      // T2: a real binary on this host (anvil), started by the test. Only
      // ci/t2.sh turns it on (CHAIN_INSIGHTS_T2=1); `npm test` and the T1
      // tier never run it.
      ...(process.env['CHAIN_INSIGHTS_T2'] === '1'
        ? [
            {
              test: {
                name: 't2',
                env: { CHAIN_INSIGHTS_SKILL_REFRESH: '0' },
                include: ['tests/**/*.t2.test.ts'],
                testTimeout: 60_000,
                hookTimeout: 60_000,
              },
            },
          ]
        : []),
      {
        test: {
          name: 'integration',
          // The proxy refreshes the skill copies in the real home when it
          // starts; a test run must never write there.
          env: { CHAIN_INSIGHTS_SKILL_REFRESH: '0' },
          include: ['tests/**/*.integration.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/wallet/mcp-proxy/assets/**'],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Ratchet: measured 2026-08-14 (lines 73.3, statements 72.9,
      // functions 79.7, branches 69.7). Only raise these numbers.
      thresholds: {
        lines: 73,
        functions: 79,
        branches: 69,
        statements: 72,
      },
    },
  },
})
