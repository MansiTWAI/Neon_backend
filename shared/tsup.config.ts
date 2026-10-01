import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'web/client': 'src/web/client.ts',
    'web/server': 'src/web/server.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['next', 'firebase', 'react'],
});
