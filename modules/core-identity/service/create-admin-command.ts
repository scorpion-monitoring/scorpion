// `scorpion create-admin`: the administrator of a fresh install, from a shell. The password comes
// from the terminal prompt or from standard input, never from the command line, and appears in no
// output.
import { parseArgs } from 'node:util';
import { Conflict, Invalid } from '@scorpion/contracts';
import type { CommandDef, CommandIo } from '@scorpion/kernel';
import type { BootstrapService } from './bootstrap.ts';

const USAGE = 'create-admin --username <name> --email <address>';

export function createAdminCommand(bootstrap: () => BootstrapService): CommandDef {
  return {
    name: 'create-admin',
    usage: USAGE,
    description:
      'Create an active administrator account. The password is read from the terminal or from stdin, never from an argument.',
    async run(args: readonly string[], io: CommandIo) {
      if (args.some((arg) => /^--?pass(word)?\b/i.test(arg))) {
        io.err(
          'A password is never taken from the command line. Leave it out: you are asked for it.',
        );
        return 2;
      }
      let values: { username?: string; email?: string };
      try {
        ({ values } = parseArgs({
          args: [...args],
          options: { username: { type: 'string' }, email: { type: 'string' } },
          strict: true,
        }));
      } catch (error) {
        io.err(`${(error as Error).message}\nUsage: scorpion ${USAGE}`);
        return 2;
      }
      if (!values.username || !values.email) {
        io.err(`Usage: scorpion ${USAGE}`);
        return 2;
      }

      const password = await io.readSecret('Password: ');
      try {
        const admin = await bootstrap().createAdmin(
          { username: values.username, email: values.email, password },
          'cli',
        );
        io.out(`Created the administrator "${admin.username}".`);
        return 0;
      } catch (error) {
        // `Invalid` names the fields, never their values, so it is safe to show.
        if (error instanceof Invalid) {
          const problems = error.errors?.map((e) => `  ${e.path}: ${e.message}`).join('\n');
          io.err(`Not created: the input is not valid.${problems ? `\n${problems}` : ''}`);
          return 1;
        }
        if (error instanceof Conflict) {
          io.err(`Not created: ${error.message}`);
          return 1;
        }
        throw error;
      }
    },
  };
}
