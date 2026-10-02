// The only file other modules may import. It holds the service interface and nothing else.
//
// Most of core.settings is reached through the kernel, not through this interface: a module reads
// its own settings with `ctx.settings` (ADR 0017), registers preferences in the registry
// `settings.userPreference` and declares vocabularies in the registry `vocabulary`. What remains is
// what other modules ask of it at run time: a secret, the instance's branding and the terms of a
// vocabulary. None of these methods checks a permission; they are for trusted code (ADR 0015).

/** The effective branding of the instance, defaults applied (ADR 0018). */
export interface Branding {
  productName: string;
  /** The instance name, or the product name when none is set. */
  instanceName: string;
  /** The `From` address of mails. */
  mailFrom: string;
  contactEmail: string | null;
  imprintUrl: string | null;
  /** SHA-256 hashes of uploaded files, served at `GET /files/{hash}`. */
  logos: { light: string | null; dark: string | null };
  /** The legal pages that have a text: `terms`, `privacy`, `imprint`. */
  legalPages: ('terms' | 'privacy' | 'imprint')[];
}

export interface VocabularyTerm {
  /** What a module stores. */
  key: string;
  labels: Record<string, string>;
  /** The label for the requested locale. */
  label: string;
  sortOrder: number;
  active: boolean;
}

/** Answers whether anything the module owns still refers to the term (so it is deactivated, not deleted). */
export type UsageCheck = (termKey: string) => Promise<boolean>;

/**
 * An entry of the registry `vocabulary`. Several entries may share an `id`: one declares the terms,
 * another (from the module that stores the keys) adds a `usage` check. At least one has a `description`.
 */
export interface VocabularyContribution {
  id: string;
  description?: string;
  /** Added when missing at every start; what an administrator changed is not overwritten. */
  terms?: { key: string; labels: Record<string, string>; sortOrder?: number }[];
  usage?: UsageCheck;
}

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

  /**
   * The effective branding. Cached for a few seconds like every setting (ADR 0017); `fresh` reads the
   * database, for a handler that reacts to a change and must not see the old value.
   */
  getBranding(options?: { fresh?: boolean }): Promise<Branding>;

  /**
   * The terms of a vocabulary, in order (`sortOrder`, then key). Active terms only, unless
   * `includeInactive`. `NotFound` for a vocabulary no loaded module declares.
   */
  listTerms(
    vocabularyId: string,
    options?: { includeInactive?: boolean; locale?: string },
  ): Promise<VocabularyTerm[]>;

  /**
   * `Invalid` (422, naming `path`) unless `key` is a term of the vocabulary. A deactivated term is
   * refused for anything new; pass `allowInactive` when an existing value is being kept as it is.
   */
  validateTerm(
    vocabularyId: string,
    key: string,
    options?: { allowInactive?: boolean; path?: string },
  ): Promise<void>;
}

// Lets `ctx.deps['core.settings']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.settings': SettingsService;
  }
}
