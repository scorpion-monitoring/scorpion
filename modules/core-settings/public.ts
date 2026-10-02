// The only file other modules may import. It holds the service interface and nothing else.
//
// Most of core.settings is reached through the kernel, not through this interface: a module reads
// its own settings with `ctx.settings` (ADR 0017) and registers preferences in the registry
// `settings.userPreference`. What remains is the one call that hands out a secret.

export interface SettingsService {
  /**
   * The value of a stored secret, or `undefined` when none is stored under `name`. **For trusted
   * code only**: it checks no permission and returns the plaintext, like the system methods of
   * `core.authz` (ADR 0015). The trust boundary is the profile's module list: a module that
   * declares `core.settings` as a dependency can call it, as it could read the table. Use the value
   * for the one call that needs it and put it nowhere else: not in settings, a log line, an error
   * message, a response or an event. `SecretDecryptError` when the row cannot be decrypted with the
   * keys at hand.
   */
  getSecret(name: string): Promise<string | undefined>;
}

// Lets `ctx.deps['core.settings']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.settings': SettingsService;
  }
}
