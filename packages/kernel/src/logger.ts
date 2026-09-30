import { pino, type DestinationStream, type Logger } from 'pino';
import { maskSecrets, REDACTED, REDACTED_PATHS } from './redact.ts';

export type { Logger } from 'pino';

export interface LoggerOptions {
  level: string;
  /** Where to write; default: standard output. Tests pass a stream to read the lines back. */
  destination?: DestinationStream;
}

/** The root logger: JSON lines, secrets redacted (see redact.ts). */
export function createLogger({ level, destination }: LoggerOptions): Logger {
  return pino(
    {
      level,
      redact: { paths: [...REDACTED_PATHS], censor: REDACTED },
      hooks: {
        // Mask credentials inside message strings and objects (for example a connection URL in an
        // error message), which `redact` by field name cannot see.
        logMethod(args, method) {
          method.apply(this, args.map((arg) => maskSecrets(arg)) as Parameters<typeof method>);
        },
      },
    },
    destination,
  );
}

export interface LogBindings {
  module?: string;
  requestId?: string;
  jobId?: string;
}

/** A child logger that carries `module`, `requestId` and `jobId` when they are present. */
export function childLogger(parent: Logger, bindings: LogBindings): Logger {
  return parent.child(
    Object.fromEntries(Object.entries(bindings).filter(([, value]) => value !== undefined)),
  );
}
