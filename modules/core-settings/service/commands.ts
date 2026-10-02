// The CLI commands of core.settings (ADR 0009, ADR 0016). Entry points like routes: they call the
// secrets service and hold no logic of their own. Nothing here prints a secret, a key or a key id.
import type { CommandDef, CommandIo } from '@scorpion/kernel';
import { Invalid } from '@scorpion/contracts';
import { parseArgs } from 'node:util';
import { MAX_SECRET_LENGTH, SECRET_NAME, type SecretsInternals } from './secrets.ts';

export function createSetSecretCommand(secrets: () => SecretsInternals): CommandDef {
  return {
    name: 'set-secret',
    description:
      'Store or replace an encrypted secret. The value is read from the terminal or standard input.',
    usage: 'set-secret <name>',
    async run(args: readonly string[], io: CommandIo) {
      if (args.length !== 1 || args[0]!.startsWith('-')) {
        io.err(
          'Usage: scorpion set-secret <name>\nThe value is asked for; it is never taken from the command line.',
        );
        return 2;
      }
      const name = args[0]!;
      if (!SECRET_NAME.test(name)) {
        io.err(
          'The secret name is not valid: use lower-case letters, digits, ".", "-" and "_", starting with a letter.',
        );
        return 2;
      }
      const value = (await io.readSecret('Value: ')).replace(/\r?\n$/, '');
      if (value.length === 0 || value.length > MAX_SECRET_LENGTH) {
        io.err(`The value must be 1 to ${MAX_SECRET_LENGTH} characters. Nothing was stored.`);
        return 2;
      }
      try {
        await secrets().setAsSystem(name, value);
      } catch (error) {
        if (error instanceof Invalid) {
          io.err(`${error.message} Nothing was stored.`);
          return 2;
        }
        throw error;
      }
      io.out(`Stored the secret "${name}".`);
      return 0;
    },
  };
}

export function createRotateSecretsCommand(secrets: () => SecretsInternals): CommandDef {
  return {
    name: 'rotate-secrets',
    description:
      'Re-encrypt every stored secret under SECRETS_KEY_NEXT. Safe to stop and run again.',
    usage: 'rotate-secrets [--batch-size <n>]',
    async run(args: readonly string[], io: CommandIo) {
      let batchSize: number | undefined;
      try {
        const { values } = parseArgs({
          args: [...args],
          options: { 'batch-size': { type: 'string' } },
          allowPositionals: false,
        });
        if (values['batch-size'] !== undefined) {
          if (!/^[1-9]\d{0,5}$/.test(values['batch-size'])) throw new Error('bad batch size');
          batchSize = Number(values['batch-size']);
        }
      } catch {
        io.err('Usage: scorpion rotate-secrets [--batch-size <whole number, 1 to 999999>]');
        return 2;
      }
      try {
        const report = await secrets().rotate({ batchSize });
        io.out(
          report.rotated === 0 && report.remaining === 0
            ? 'Nothing to rotate: every secret is already under SECRETS_KEY_NEXT.'
            : `Re-encrypted ${report.rotated} secret(s); ${report.remaining} remain on another key.`,
        );
        if (report.remaining === 0) {
          io.out(
            'Now set SECRETS_KEY to the value of SECRETS_KEY_NEXT, remove SECRETS_KEY_NEXT, and restart every process.',
          );
        }
        return report.remaining === 0 ? 0 : 1;
      } catch (error) {
        // The messages of the service name a secret at most; they never hold a value or a key.
        io.err(`Rotation stopped: ${error instanceof Error ? error.message : 'unknown error'}`);
        io.err(
          'Nothing was lost: everything committed so far is readable. Fix the cause and run it again.',
        );
        return 1;
      }
    },
  };
}
