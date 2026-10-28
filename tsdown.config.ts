import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
    'mcp-proxy': 'src/mcp/proxy.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'node',
  dts: true,
  clean: true,
  shims: true,
  // rolldown 1.2.12 panics in its CJS module finalizer ("no entry found for
  // key") when its default smart constant inlining meets the top-up server
  // as it is since 0.73.0. Inlining constants is a size optimisation only;
  // the output means the same without it.
  inputOptions: { optimization: { inlineConst: false } },
})
