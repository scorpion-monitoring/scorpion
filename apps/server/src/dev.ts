// `pnpm dev` runs the API behind the web app (ADR-0027): it listens on API_PORT, which `scripts/dev.ts`
// sets, while PORT is the web app's. Everything else is `scorpion start`.
if (process.env.API_PORT) process.env.PORT = process.env.API_PORT;
process.argv.splice(2, 0, 'start');
await import('./cli.ts');
