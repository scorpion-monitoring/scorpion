import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { terminalIo } from './cli-io.ts';

function sink() {
  const chunks: string[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  return { stream, text: () => chunks.join('') };
}

describe('terminalIo', () => {
  it('writes out() to stdout and err() to stderr, one line each', () => {
    const out = sink();
    const err = sink();
    const io = terminalIo({ stdin: Readable.from([]), stdout: out.stream, stderr: err.stream });
    io.out('hello');
    io.err('oops');
    expect(out.text()).toBe('hello\n');
    expect(err.text()).toBe('oops\n');
  });

  it('reads a secret as one line of a pipe, without a prompt', async () => {
    const err = sink();
    const io = terminalIo({
      stdin: Readable.from(['first line\nsecond line\n']),
      stdout: sink().stream,
      stderr: err.stream,
    });
    expect(await io.readSecret('Password: ')).toBe('first line');
    expect(err.text()).toBe('');
  });

  it('reads an empty line (or none) as an empty secret', async () => {
    const io = terminalIo({
      stdin: Readable.from([]),
      stdout: sink().stream,
      stderr: sink().stream,
    });
    expect(await io.readSecret('Password: ')).toBe('');
  });

  it('prompts on stderr, does not echo what is typed, handles backspace, and restores the terminal', async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
    const err = sink();
    const out = sink();
    const io = terminalIo({ stdin, stdout: out.stream, stderr: err.stream });

    const secret = io.readSecret('Password: ');
    stdin.write('ab');
    stdin.write('\u007fc\r');
    expect(await secret).toBe('ac');

    expect(err.text()).toBe('Password: \n'); // the prompt and the newline, nothing typed
    expect(out.text()).toBe('');
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('gives up on Ctrl-C and still restores the terminal', async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
    const io = terminalIo({ stdin, stdout: sink().stream, stderr: sink().stream });
    const secret = io.readSecret('Password: ');
    stdin.write('ab\u0003');
    await expect(secret).rejects.toThrow('Cancelled.');
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
