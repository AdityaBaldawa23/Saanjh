// Bundles the Express API into one ESM file that Vercel's /api function imports.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/vercel.ts'],
  outfile: 'server/dist/vercel.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  // pg-native is optional; PGlite is only used for local development.
  external: ['pg-native', '@electric-sql/pglite'],
  // CommonJS dependencies (express, multer…) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
