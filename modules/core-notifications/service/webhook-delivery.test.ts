import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mail, useNotifications } from '../test/harness.ts';
import { signBody } from './transports/webhook.ts';

const harness = useNotifications();

interface Seen {
  headers: http.IncomingHttpHeaders;
  body: string;
}
let server: http.Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
  server = undefined;
});
async function receiver(status = 200) {
  const seen: Seen[] = [];
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, seen };
}

const webhook = (port: number, extra: Record<string, unknown> = {}) => ({
  enabled: true,
  url: `http://127.0.0.1:${port}/hook`,
  allowPrivateTargets: true,
  ...extra,
});
const secrets = { 'notifications.webhook.secret': 'hook-secret' };

describe('the webhook channel', () => {
  it('posts the message signed with the secret from the secrets store', async () => {
    const { port, seen } = await receiver();
    const t = await harness.start({ settings: { webhook: webhook(port) }, secrets });
    const id = await t.mail.send(
      mail({
        channel: 'webhook',
        recipientAddress: undefined,
        subject: 'Admin notice',
        text: 'Something happened',
      }),
    );
    expect(await t.notifications.deliverDue()).toMatchObject({ claimed: 1, sent: 1 });
    expect(seen).toHaveLength(1);
    const request = seen[0]!;
    const timestamp = Number(request.headers['x-scorpion-timestamp']);
    expect(request.headers['x-scorpion-signature']).toBe(
      signBody('hook-secret', timestamp, request.body),
    );
    expect(JSON.parse(request.body)).toMatchObject({
      id,
      subject: 'Admin notice',
      text: 'Something happened',
    });
    expect(await t.delivery(id!)).toMatchObject({
      status: 'sent',
      transport: 'webhook',
      channel: 'webhook',
    });
  });

  it('refuses a private target unless allowPrivateTargets is on: the row retries and nothing is sent', async () => {
    const { port, seen } = await receiver();
    const t = await harness.start({
      settings: {
        webhook: webhook(port, {
          allowPrivateTargets: false,
          url: `https://127.0.0.1:${port}/hook`,
        }),
      },
      secrets,
    });
    const id = await t.mail.send(mail({ channel: 'webhook', recipientAddress: undefined }));
    expect(await t.notifications.deliverDue()).toMatchObject({ retried: 1, sent: 0 });
    expect(await t.delivery(id!)).toMatchObject({ status: 'queued', last_error: 'target-refused' });
    expect(seen).toEqual([]);
  });

  it('retries with not-configured while the signing secret is missing', async () => {
    const { port, seen } = await receiver();
    const t = await harness.start({ settings: { webhook: webhook(port) } });
    const id = await t.mail.send(mail({ channel: 'webhook', recipientAddress: undefined }));
    await t.notifications.deliverDue();
    expect(await t.delivery(id!)).toMatchObject({ status: 'queued', last_error: 'not-configured' });
    expect(seen).toEqual([]);
  });

  it('records the status code of a receiver that fails, and keeps going with email', async () => {
    const { port } = await receiver(502);
    const t = await harness.start({ settings: { webhook: webhook(port) }, secrets });
    const hook = await t.mail.send(mail({ channel: 'webhook', recipientAddress: undefined }));
    const email = await t.mail.send(mail());
    expect(await t.notifications.deliverDue()).toMatchObject({ claimed: 2, sent: 1, retried: 1 });
    expect(await t.delivery(hook!)).toMatchObject({ status: 'queued', last_error: 'http-502' });
    expect(await t.delivery(email!)).toMatchObject({ status: 'sent', transport: 'none' });
  });
});
