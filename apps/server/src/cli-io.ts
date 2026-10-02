// How a CLI command talks to the person at the terminal. The one rule that matters: a secret is
// never read from the command line, where the process list and the shell history keep it.
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { CommandIo } from '@scorpion/kernel';

export interface TerminalStreams {
  stdin: Readable & { isTTY?: boolean; setRawMode?: (raw: boolean) => unknown };
  stdout: Writable;
  stderr: Writable;
}

/** Reads one line of text from a stream that is not a terminal (a pipe or a file). */
async function readLine(input: Readable): Promise<string> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) return line;
    return '';
  } finally {
    lines.close();
  }
}

/** Reads a line from a terminal without echoing it. Backspace works; Ctrl-C and Ctrl-D end the read. */
function readHidden(streams: TerminalStreams, prompt: string): Promise<string> {
  const { stdin, stderr } = streams;
  return new Promise((resolve, reject) => {
    let value = '';
    stderr.write(prompt);
    stdin.setRawMode?.(true);
    stdin.resume();
    const finish = (result: () => void) => {
      stdin.off('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      stderr.write('\n');
      result();
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') return finish(() => resolve(value));
        if (char === '\u0003' || char === '\u0004') {
          return finish(() => reject(new Error('Cancelled.')));
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * The terminal as a `CommandIo`. With a terminal, `readSecret` prompts on stderr and does not echo;
 * without one (a pipe, `docker run -i`) it reads one line of standard input and prints no prompt.
 */
export function terminalIo(streams: TerminalStreams): CommandIo {
  return {
    out: (text) => void streams.stdout.write(`${text}\n`),
    err: (text) => void streams.stderr.write(`${text}\n`),
    readSecret: (prompt) =>
      streams.stdin.isTTY ? readHidden(streams, prompt) : readLine(streams.stdin),
  };
}
