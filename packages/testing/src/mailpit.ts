// A Mailpit container: a real SMTP relay with a JSON API, for the journey that must show mail
// arriving in an inbox (registration, retries after the relay was down). One container per test
// file. The image is the one `docker-compose.dev.yml` runs.
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

export const MAILPIT_IMAGE = 'axllent/mailpit:v1.31.3';

export interface MailpitMessage {
  id: string;
  from: { name: string; address: string };
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface StartedMailpit {
  /** Where Scorpion's SMTP transport connects. */
  readonly smtpHost: string;
  readonly smtpPort: number;
  /** Every message the relay holds, oldest first, with bodies. */
  messages(): Promise<MailpitMessage[]>;
  /** Polls until `count` messages are held (or fails after `timeoutMs`). */
  waitForMessages(count: number, timeoutMs?: number): Promise<MailpitMessage[]>;
  clear(): Promise<void>;
  stop(): Promise<void>;
}

interface ApiList {
  messages: { ID: string }[];
}
interface ApiMessage {
  ID: string;
  From: { Name: string; Address: string };
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
}

export async function startMailpit(): Promise<StartedMailpit> {
  const container: StartedTestContainer = await new GenericContainer(MAILPIT_IMAGE)
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp('/livez', 8025).forStatusCode(200))
    .start();
  const api = (path: string, init?: RequestInit) =>
    fetch(`http://${container.getHost()}:${container.getMappedPort(8025)}/api/v1${path}`, init);

  async function messages(): Promise<MailpitMessage[]> {
    const list = (await (await api('/messages?limit=500')).json()) as ApiList;
    const full = await Promise.all(
      list.messages.map(
        async ({ ID }) => (await (await api(`/message/${ID}`)).json()) as ApiMessage,
      ),
    );
    // The API lists newest first.
    return full.reverse().map((m) => ({
      id: m.ID,
      from: { name: m.From.Name, address: m.From.Address },
      to: m.To.map((t) => t.Address),
      subject: m.Subject,
      text: m.Text,
      html: m.HTML,
    }));
  }

  return {
    smtpHost: container.getHost(),
    smtpPort: container.getMappedPort(1025),
    messages,
    async waitForMessages(count, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = await messages();
        if (found.length >= count) return found;
        if (Date.now() > deadline) {
          throw new Error(`expected ${count} message(s) in Mailpit, found ${found.length}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
    async clear() {
      await api('/messages', { method: 'DELETE' });
    },
    async stop() {
      await container.stop();
    },
  };
}
