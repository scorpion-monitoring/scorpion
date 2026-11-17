// `pnpm migrate-legacy <command>`: the process around `runCli` (src/cli.ts).
import { runCli } from './src/cli.ts';

const code = await runCli(process.argv.slice(2), {
  env: process.env,
  io: {
    out: (text) => void process.stdout.write(`${text}\n`),
    err: (text) => void process.stderr.write(`${text}\n`),
  },
});
process.exitCode = code;
