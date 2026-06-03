import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: true,
  clean: true,
  // `dependencies` (incl. libpg-query, which ships a WASM blob) are kept external
  // and resolved from node_modules at runtime — this is tsdown's default.
})
