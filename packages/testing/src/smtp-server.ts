// A relay for tests: speaks just enough SMTP for Nodemailer (no TLS, no AUTH), keeps what it was
// given, and can be stopped and started again on the same port to play "the relay is down".
import net from 'node:net';

export interface ReceivedMail {
  from: string;
  to: string[];
  data: string;
}

export interface TestSmtpServer {
  readonly port: number;
  readonly received: ReceivedMail[];
  /** The user and password of every AUTH PLAIN or AUTH LOGIN the relay accepted. */
  readonly credentials: { user: string; password: string }[];
  /** Stops listening and drops every connection: the next connect is refused. */
  stop(): Promise<void>;
  /** Listens again on the same port. */
  restart(): Promise<void>;
}

export async function startSmtpServer(): Promise<TestSmtpServer> {
  const received: ReceivedMail[] = [];
  const credentials: { user: string; password: string }[] = [];
  const sockets = new Set<net.Socket>();

  function build(): net.Server {
    return net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => undefined);
      socket.write('220 test ESMTP\r\n');
      let buffer = '';
      let from = '';
      let to: string[] = [];
      let data: string | undefined;
      let login: { user?: string } | undefined;
      const decode = (text: string) => Buffer.from(text.trim(), 'base64').toString('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        for (;;) {
          if (data !== undefined) {
            const end = buffer.indexOf('\r\n.\r\n');
            if (end === -1) return;
            data += buffer.slice(0, end);
            buffer = buffer.slice(end + 5);
            received.push({ from, to, data });
            data = undefined;
            socket.write('250 queued\r\n');
            continue;
          }
          const eol = buffer.indexOf('\r\n');
          if (eol === -1) return;
          const line = buffer.slice(0, eol);
          buffer = buffer.slice(eol + 2);
          if (login) {
            if (login.user === undefined) {
              login.user = decode(line);
              socket.write('334 UGFzc3dvcmQ6\r\n');
            } else {
              credentials.push({ user: login.user, password: decode(line) });
              login = undefined;
              socket.write('235 ok\r\n');
            }
            continue;
          }
          const command = line.slice(0, 4).toUpperCase();
          if (command === 'EHLO' || command === 'HELO')
            socket.write('250-test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
          else if (command === 'AUTH') {
            const [, mechanism, initial] = line.split(' ');
            if (mechanism?.toUpperCase() === 'PLAIN' && initial) {
              const [, user = '', password = ''] = decode(initial).split('\0');
              credentials.push({ user, password });
              socket.write('235 ok\r\n');
            } else if (mechanism?.toUpperCase() === 'LOGIN') {
              login = {};
              socket.write('334 VXNlcm5hbWU6\r\n');
            } else socket.write('504 no\r\n');
          } else if (command === 'MAIL') {
            from = /<([^>]*)>/.exec(line)?.[1] ?? '';
            to = [];
            socket.write('250 ok\r\n');
          } else if (command === 'RCPT') {
            to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
            socket.write('250 ok\r\n');
          } else if (command === 'DATA') {
            data = '';
            socket.write('354 go\r\n');
          } else if (command === 'QUIT') {
            socket.end('221 bye\r\n');
          } else socket.write('250 ok\r\n');
        }
      });
    });
  }

  let server = build();
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  await listen(0);
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    received,
    credentials,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    async restart() {
      server = build();
      await listen(port);
    },
  };
}
