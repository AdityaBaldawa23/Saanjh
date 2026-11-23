// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
// The Express app is bundled to server/dist/vercel.mjs during the build (npm run vercel-build).
export { default } from '../server/dist/vercel.mjs';
