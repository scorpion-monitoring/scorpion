// Which logo the header draws for each theme. An operator's upload (a file in the blob store, named by its hash) wins;
// until there is one, the built-in logos of the software are the fallback. The dark logo falls back to the operator's
// light logo before it falls back to the built-in dark one, so an instance that uploaded only one logo never shows the
// Scorpion mark next to its own.
export interface LogoSettings {
  light: string | null;
  dark: string | null;
}

export interface LogoSources {
  /** The address of the logo for light themes. */
  light: string;
  /** The address of the logo for dark themes. */
  dark: string;
  /** Whether the instance has uploaded any logo; false while the built-in ones are shown. */
  custom: boolean;
}

/**
 * @param logos the hashes from the branding settings (`null` where none is set)
 * @param builtIn the addresses of the built-in logos (assets of the web app)
 * @param file the address of an uploaded file, from its hash
 */
export function logoSources(
  logos: LogoSettings,
  builtIn: { light: string; dark: string },
  file: (hash: string) => string,
): LogoSources {
  return {
    light: logos.light ? file(logos.light) : builtIn.light,
    dark: logos.dark ? file(logos.dark) : logos.light ? file(logos.light) : builtIn.dark,
    custom: Boolean(logos.light ?? logos.dark),
  };
}
