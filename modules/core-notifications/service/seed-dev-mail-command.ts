// `scorpion seed-dev-mail`: points a local instance at the Mailpit of `docker-compose.dev.yml`.
// For development only: it refuses to run when NODE_ENV is `production` (every image sets it), so
// a production instance never gets a relay it did not configure. It writes the settings of this
// module only when none are stored, so a developer's own choice is never overwritten.
import { Invalid } from '@scorpion/contracts';
import type { CommandDef, CommandIo, ModuleContext } from '@scorpion/kernel';
import { parseArgs } from 'node:util';
import type { NotificationSettings } from '../settings-schema.ts';

const USAGE = 'seed-dev-mail [--host <name>] [--port <number>]';

export function createSeedDevMailCommand(): CommandDef<
  ModuleContext<'core.authz' | 'core.settings', never, NotificationSettings>
> {
  return {
    name: 'seed-dev-mail',
    usage: USAGE,
    description:
      'Development only: send mail to the local Mailpit (smtp localhost:1025) when no settings are stored yet. Refuses in production.',
    async run(args: readonly string[], io: CommandIo, ctx) {
      if (process.env.NODE_ENV === 'production') {
        io.err(
          'seed-dev-mail is for local development and refuses to run with NODE_ENV=production.',
        );
        return 1;
      }
      let values: { host?: string; port?: string };
      try {
        ({ values } = parseArgs({
          args: [...args],
          options: { host: { type: 'string' }, port: { type: 'string' } },
          strict: true,
        }));
      } catch (error) {
        io.err(`${(error as Error).message}\nUsage: scorpion ${USAGE}`);
        return 2;
      }
      if (values.port !== undefined && !/^[1-9]\d{0,4}$/.test(values.port)) {
        io.err(`The port must be a whole number from 1 to 65535.\nUsage: scorpion ${USAGE}`);
        return 2;
      }
      try {
        const result = await ctx.deps['core.settings'].seedSettings('core.notifications', {
          emailTransport: 'smtp',
          smtp: {
            host: values.host ?? 'localhost',
            port: Number(values.port ?? 1025),
            tls: 'none',
            user: '',
            timeoutSeconds: 10,
          },
        });
        io.out(
          result === 'seeded'
            ? 'Mail now goes to the local Mailpit (web UI: http://localhost:8025).'
            : 'The mail settings are already stored; nothing was changed.',
        );
        return 0;
      } catch (error) {
        if (error instanceof Invalid) {
          io.err('The values are not valid for the mail settings. Nothing was stored.');
          return 2;
        }
        throw error;
      }
    },
  };
}
