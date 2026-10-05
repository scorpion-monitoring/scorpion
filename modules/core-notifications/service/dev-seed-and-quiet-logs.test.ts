// The two behaviours of an instance with nothing configured: a developer's `seed-dev-mail` points
// it at Mailpit (never in production, never over a stored choice), and with `emailTransport = none`
// the log gets one line at start-up and a counter instead of a warning per message.
import type { CommandIo } from '@scorpion/kernel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mail, useNotifications } from '../test/harness.ts';

const harness = useNotifications();

function terminal() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIo = {
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    readSecret: () => Promise.reject(new Error('no prompt expected')),
  };
  return { io, out, err };
}

const stored = async (t: Awaited<ReturnType<typeof harness.start>>) =>
  (
    await t.kernel.pool.query<{ value: unknown }>(
      "select value from settings_setting where module_id = 'core.notifications'",
    )
  ).rows[0]?.value;

describe('scorpion seed-dev-mail', () => {
  const previous = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = previous;
  });

  it('points a fresh instance at the local Mailpit and says where to look', async () => {
    const t = await harness.start();
    const term = terminal();
    expect(await t.kernel.runCommand('seed-dev-mail', [], term.io)).toBe(0);
    expect(term.out.join('\n')).toContain('8025');
    expect(await stored(t)).toEqual({
      emailTransport: 'smtp',
      smtp: { host: 'localhost', port: 1025, tls: 'none', user: '', timeoutSeconds: 10 },
    });
    expect((await t.notifications.status(await t.actorOf('admin'))).emailTransport).toBe('smtp');
  });

  it('takes a host and a port for a compose network', async () => {
    const t = await harness.start();
    expect(
      await t.kernel.runCommand(
        'seed-dev-mail',
        ['--host', 'mailpit', '--port', '2525'],
        terminal().io,
      ),
    ).toBe(0);
    expect(await stored(t)).toMatchObject({ smtp: { host: 'mailpit', port: 2525 } });
  });

  it('never overwrites settings that are already stored', async () => {
    const t = await harness.start({ settings: { emailTransport: 'none', maxAttempts: 3 } });
    const term = terminal();
    expect(await t.kernel.runCommand('seed-dev-mail', [], term.io)).toBe(0);
    expect(term.out.join('\n')).toContain('nothing was changed');
    expect(await stored(t)).toEqual({ emailTransport: 'none', maxAttempts: 3 });
  });

  it('refuses with NODE_ENV=production and stores nothing', async () => {
    process.env.NODE_ENV = 'production';
    const t = await harness.start();
    const term = terminal();
    expect(await t.kernel.runCommand('seed-dev-mail', [], term.io)).toBe(1);
    expect(term.err.join('\n')).toContain('production');
    expect(await stored(t)).toBeUndefined();
  });

  it.each([['--port', 'abc'], ['--port', '0'], ['--port', '70000'], ['--nope']])(
    'refuses bad arguments %j (exit 2) and stores nothing',
    async (...args) => {
      const t = await harness.start();
      expect(await t.kernel.runCommand('seed-dev-mail', args, terminal().io)).toBe(2);
      expect(await stored(t)).toBeUndefined();
    },
  );
});

describe('an instance whose emailTransport is none', () => {
  it('logs one line at start-up that says what happens to mail', async () => {
    const t = await harness.start();
    const lines = t.logs.filter((line) => line.includes('emailTransport is \\"none\\"'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).level).toBe(40); // warn
  });

  it('logs nothing per message, counts what it dropped and shows it in the status', async () => {
    const t = await harness.start();
    const before = t.logs.length;
    for (let i = 0; i < 5; i += 1) await t.mail.send(mail());
    const report = await t.notifications.deliverDue();
    expect(report).toMatchObject({ claimed: 5, sent: 5, dropped: 5 });
    const added = t.logs.slice(before).filter((line) => JSON.parse(line).level >= 40);
    expect(added).toEqual([]);
    const status = await t.notifications.status(await t.actorOf('admin'));
    expect(status).toMatchObject({ transportIsNone: true, sentWithoutTransport: 5 });
  });

  it('does not log that line when a relay is configured, and counts nothing as dropped', async () => {
    const t = await harness.start({
      settings: { emailTransport: 'smtp', smtp: { host: '127.0.0.1', port: 9, tls: 'none' } },
    });
    expect(t.logs.some((line) => line.includes('emailTransport is'))).toBe(false);
    expect((await t.notifications.status(await t.actorOf('admin'))).sentWithoutTransport).toBe(0);
  });
});
