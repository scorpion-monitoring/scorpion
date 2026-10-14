// `pnpm test:all`: the unit and integration tests and the end-to-end suite at the same time.
//
// They share nothing: the unit tests start their databases with Testcontainers on random ports, the end-to-end runs use
// ports 4173 to 4190 and their own containers. Run one after the other they take about 27 minutes; together, with
// `scripts/e2e-parallel.ts`, about as long as the slower of the two halves of the e2e suite. It needs the cores for it
// (CPU contention is also the one thing that can make a timing test flaky, so a failure here that does not repeat is
// run again alone). The full serial run, `pnpm test` then `CI=true pnpm test:e2e`, stays what CI does.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const parts = [
  { label: 'unit', args: ['test'] },
  { label: 'e2e', args: ['test:e2e:parallel'] },
];

function prefixed(label: string, stream: NodeJS.ReadableStream) {
  let rest = '';
  stream.on('data', (chunk: Buffer) => {
    const lines = (rest + chunk.toString()).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) console.log(`[${label}] ${line}`);
  });
  stream.on('end', () => rest && console.log(`[${label}] ${rest}`));
}

const started = Date.now();
const results = new Map<string, number>();
for (const part of parts) {
  const child = spawn('pnpm', part.args, {
    cwd: repo,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  prefixed(part.label, child.stdout);
  prefixed(part.label, child.stderr);
  child.on('close', (code) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`${part.label}: exit ${code} after ${seconds} s`);
    results.set(part.label, code ?? 1);
    if (results.size < parts.length) return;
    process.exit([...results.values()].every((value) => value === 0) ? 0 : 1);
  });
}
