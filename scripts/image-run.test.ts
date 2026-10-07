import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { plan, supervise, type Child } from './image-run.ts';

describe('plan', () => {
  it('runs the API alone on PORT when the image has no web app', () => {
    const { children, problems } = plan({ PORT: '3000', TRUSTED_PROXIES: '10.0.0.0/8' }, false);
    expect(problems).toEqual([]);
    expect(children.map((child) => child.name)).toEqual(['api']);
    expect(children[0]!.args).toEqual(['apps/server/src/cli.ts', 'start']);
    expect(children[0]!.env).toEqual({ PORT: '3000', TRUSTED_PROXIES: '10.0.0.0/8' });
  });

  it('puts the web server on PORT and the API on API_PORT, and tells the web server where the API is', () => {
    const { children, problems } = plan({ PORT: '8080', API_PORT: '9090' }, true);
    expect(problems).toEqual([]);
    const [api, web] = children;
    expect(api!.name).toBe('api');
    expect(api!.env.PORT).toBe('9090');
    expect(web!.name).toBe('web');
    expect(web!.args).toEqual(['apps/web/src/front/main.ts']);
    expect(web!.env.PORT).toBe('8080');
    expect(web!.env.API_ORIGIN).toBe('http://127.0.0.1:9090');
  });

  it('defaults to 3000 and 3001', () => {
    const [api, web] = plan({}, true).children;
    expect(web!.env.PORT).toBe('3000');
    expect(api!.env.PORT).toBe('3001');
    expect(web!.env.API_ORIGIN).toBe('http://127.0.0.1:3001');
  });

  it('makes the API trust the web process, and keeps the proxies the operator named', () => {
    const [api, web] = plan({ TRUSTED_PROXIES: '10.0.0.0/8, 127.0.0.1' }, true).children;
    expect(api!.env.TRUSTED_PROXIES).toBe('10.0.0.0/8,127.0.0.1,::1');
    // The web process gets the operator's list unchanged: it does not read it.
    expect(web!.env.TRUSTED_PROXIES).toBe('10.0.0.0/8, 127.0.0.1');
    expect(plan({}, true).children[0]!.env.TRUSTED_PROXIES).toBe('127.0.0.1,::1');
  });

  it.each([
    [{ PORT: '3000', API_PORT: '3000' }, 'differ'],
    [{ PORT: 'x' }, 'PORT must be a port number'],
    [{ API_PORT: '70000' }, 'API_PORT must be a port number'],
    [{ API_PORT: '' }, 'API_PORT must be a port number'],
  ])('refuses %j', (env, message) => {
    expect(plan(env, true).problems.join(' ')).toContain(message);
  });
});

describe('supervise', () => {
  const node = (name: string, script: string): Child => ({
    name,
    args: ['-e', script],
    env: { ...process.env },
  });
  const forever = 'setInterval(() => {}, 1000)';

  it('ends with 0 when both ends cleanly, and stops the other when one ends first', async () => {
    const started = Date.now();
    const code = await supervise([node('a', 'process.exit(0)'), node('b', forever)], process.cwd());
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('ends with the exit code of the first process that fails, and stops the other', async () => {
    const code = await supervise([node('a', forever), node('b', 'process.exit(3)')], process.cwd());
    expect(code).toBe(3);
  });

  it('forwards SIGTERM to every child and ends with 0', async () => {
    const trap = (name: string) =>
      node(name, "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)");
    const signals = new EventEmitter();
    const done = supervise([trap('a'), trap('b')], process.cwd(), signals);
    setTimeout(() => signals.emit('SIGTERM'), 700);
    expect(await done).toBe(0);
  });
});
