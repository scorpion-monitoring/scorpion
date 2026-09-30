import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { childLogger, createLogger } from './logger.ts';
import { maskSecrets } from './redact.ts';

const PASSWORD = 's3cret-pw';
const URL = `postgres://scorpion:${PASSWORD}@db.internal:5432/scorpion`;
const PAT = 'scp_abcd1234_verysecretpart-XYZ';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: createLogger({ level: 'trace', destination }) };
}

describe('log redaction', () => {
  it('does not write a config object with its DATABASE_URL password', () => {
    const { lines, logger } = capture();
    logger.info({ config: loadConfig({ DATABASE_URL: URL }) }, 'starting');
    logger.info(loadConfig({ DATABASE_URL: URL }), 'flat config');
    expect(lines.join('')).not.toContain(PASSWORD);
    expect(lines.join('')).toContain('"DATABASE_URL":"[redacted]"');
  });

  it('does not write a connection URL inside a message or an error', () => {
    const { lines, logger } = capture();
    logger.error(new Error(`connect failed: ${URL}`), `cannot reach ${URL}`);
    logger.error({ err: new Error(`connect failed: ${URL}`) }, 'again');
    logger.warn({ cause: new Error('outer', { cause: new Error(URL) }) }, 'nested');
    expect(lines.join('')).not.toContain(PASSWORD);
  });

  it('removes fields with secret names, at the top level and one level down', () => {
    const { lines, logger } = capture();
    logger.info({ password: PASSWORD, user: { password: PASSWORD, token: 'tok-123' } }, 'login');
    logger.info(
      {
        req: {
          headers: { authorization: 'Bearer abc.def', cookie: 'sid=1', 'x-api-key': 'key-9' },
        },
      },
      'req',
    );
    const out = lines.join('');
    for (const secret of [PASSWORD, 'tok-123', 'abc.def', 'sid=1', 'key-9'])
      expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('masks bearer credentials and personal access tokens found in text', () => {
    const { lines, logger } = capture();
    logger.info(`header was Authorization: Bearer abc.def-ghi and token ${PAT}`);
    logger.info({ note: `token ${PAT}` }, 'object');
    const out = lines.join('');
    expect(out).not.toContain('abc.def-ghi');
    expect(out).not.toContain('verysecretpart');
  });

  it('keeps ordinary text intact', () => {
    const { lines, logger } = capture();
    logger.info(
      { count: 3, name: 'kpi.ingestion' },
      'applied migrations to http://localhost:3000/healthz',
    );
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({
      count: 3,
      name: 'kpi.ingestion',
      msg: 'applied migrations to http://localhost:3000/healthz',
    });
  });

  it('survives circular objects and deep nesting', () => {
    const loop: Record<string, unknown> = { url: URL };
    loop.self = loop;
    expect(JSON.stringify(maskSecrets(loop))).not.toContain(PASSWORD);
    let deep: unknown = { url: URL };
    for (let i = 0; i < 20; i++) deep = { deep };
    expect(JSON.stringify(maskSecrets(deep))).not.toContain(PASSWORD);
  });
});

describe('childLogger', () => {
  it('carries module, requestId and jobId when present, and leaves out the others', () => {
    const { lines, logger } = capture();
    childLogger(logger, { module: 'kpi.ingestion', requestId: 'r-1' }).info('a');
    childLogger(logger, { module: 'kpi.ingestion', jobId: 'j-1' }).info('b');
    childLogger(logger, { module: 'kpi.ingestion', requestId: undefined }).info('c');
    const [a, b, c] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(a).toMatchObject({ module: 'kpi.ingestion', requestId: 'r-1' });
    expect(a).not.toHaveProperty('jobId');
    expect(b).toMatchObject({ module: 'kpi.ingestion', jobId: 'j-1' });
    expect(b).not.toHaveProperty('requestId');
    expect(c).not.toHaveProperty('requestId');
  });
});
