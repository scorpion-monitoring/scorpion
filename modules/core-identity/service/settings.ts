// The module's settings and the one place that reads them. The manifest `settings` field is only
// validated and stored by the kernel today and `ctx` has no settings access (docs/backlog.md), so
// the module reads through this port. Its default implementation yields the defaults of the
// module's own schema; M3 (core.settings) replaces `defaultSettings` and nothing else.
import { z } from 'zod';

export const settingsSchema = z.strictObject({
  /** Whether people may register and sign in with a password. Enforced on the server (defect 13). */
  localAccounts: z.boolean().default(true),
  /** The id of the `auth.approvalPolicy` entry that decides the status of a new account. */
  approvalPolicy: z.string().min(1).default('manual'),
});

export type IdentitySettingsValues = z.infer<typeof settingsSchema>;

export interface IdentitySettings {
  get(): Promise<IdentitySettingsValues>;
}

/** Until M3: no stored settings, so the defaults of the schema apply. */
export const defaultSettings: IdentitySettings = {
  get: () => Promise.resolve(settingsSchema.parse({})),
};
