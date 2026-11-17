// The settings of core.settings itself: the numbers of the server's rate limit (pipeline step 2) and
// the instance's branding. The pipeline is not a module, so the module that stores settings owns the
// first; the server reads them through `kernel.settingsOf('core.settings')`. Branding is here because
// every module that shows or sends something with the instance's name needs it, and this module is
// the one all of them can depend on (ADR-0018).
import { z } from '@scorpion/contracts';
import {
  COLOR_TOKENS,
  HEX_COLOR,
  type ColorToken,
  type ThemeMode,
} from '@scorpion/contracts/theme-colors';

/** One token bucket: a burst, then a steady rate per minute. */
const bucket = z.strictObject({
  /** Most requests a client can make at once; the bucket's size. */
  burst: z.number().int().min(1).max(100_000),
  /** Requests that come back per minute. */
  perMinute: z.number().min(0.1).max(1_000_000),
});

/** Today's limits (M1): a burst of 120 then 120 a minute; a burst of 10 then 10 a minute. */
export const DEFAULT_RATE_LIMITS = {
  default: { burst: 120, perMinute: 120 },
  strict: { burst: 10, perMinute: 10 },
} as const;

/** What the software is called when the instance has not chosen a name. The one place that says it. */
export const DEFAULT_PRODUCT_NAME = 'Scorpion';
/** The sender of mails when none is set. */
export const DEFAULT_MAIL_FROM = 'no-reply@localhost';

/** The pages `GET /legal/{page}` serves, when the administrator wrote the text. */
export const LEGAL_PAGES = ['terms', 'privacy', 'imprint'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];
/** The longest legal text, in characters of Markdown. */
export const MAX_LEGAL_TEXT = 100_000;

/** A logo is a stored file, named by the SHA-256 of its content (`GET /files/{hash}`). */
const fileHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be the SHA-256 of an uploaded file (64 lower-case hex digits)');
const legalText = z.string().max(MAX_LEGAL_TEXT);

/** A colour of a theme: `#rrggbb` and nothing else, so a stored value can never be CSS (ADR-0051). */
const hexColor = z.string().regex(HEX_COLOR, 'must be a colour as #rrggbb (six hex digits)');

/** The labels the generated form shows for each daisyUI token. */
const TOKEN_TITLES: Record<ColorToken, string> = {
  primary: 'Primary',
  'primary-content': 'Text on primary',
  secondary: 'Secondary',
  'secondary-content': 'Text on secondary',
  accent: 'Accent',
  'accent-content': 'Text on accent',
  neutral: 'Neutral',
  'neutral-content': 'Text on neutral',
  'base-100': 'Page',
  'base-200': 'Cards',
  'base-300': 'Raised parts and borders',
  'base-content': 'Text on the page',
  info: 'Info',
  'info-content': 'Text on info',
  success: 'Success',
  'success-content': 'Text on success',
  warning: 'Warning',
  'warning-content': 'Text on warning',
  error: 'Error',
  'error-content': 'Text on error',
};

/** One theme: each token optional; an unset token keeps the built-in colour, an unset text colour may be derived. */
const themeColors = (mode: ThemeMode) =>
  z
    .strictObject(
      Object.fromEntries(
        COLOR_TOKENS.map((token) => [
          token,
          hexColor.optional().meta({ title: TOKEN_TITLES[token] }),
        ]),
      ) as Record<ColorToken, z.ZodOptional<typeof hexColor>>,
    )
    .prefault({})
    .meta({
      title: mode === 'light' ? 'Light theme' : 'Dark theme',
      widget: 'themeColors',
      mode,
    });

const brandingSchema = z.strictObject({
  /** The software's name, shown as "Powered by …" and used where no instance name is set. */
  productName: z.string().trim().min(1).max(100).default(DEFAULT_PRODUCT_NAME).meta({
    title: 'Product name',
    description:
      'The software\'s name, shown as "Powered by …" and used where no instance name is set.',
    group: 'Names',
  }),
  /** What this instance calls itself (headers, mails). Falls back to the product name. */
  instanceName: z.string().trim().min(1).max(100).optional().meta({
    title: 'Instance name',
    description:
      'What this instance calls itself (headers, mails). Falls back to the product name.',
    group: 'Names',
  }),
  /** The `From` address of mails. Falls back to `no-reply@localhost`, which no real relay accepts. */
  mailFrom: z.string().trim().min(3).max(254).optional().meta({
    title: 'Sender address of mails',
    description: 'The From address of mails. Without one, no real mail relay will accept them.',
    group: 'Contact',
  }),
  contactEmail: z.email().max(254).optional().meta({
    title: 'Contact address',
    description: 'Shown in the footer and in mails to people who need to reach someone.',
    group: 'Contact',
  }),
  /** Where the imprint lives when it is not written here. http or https. */
  imprintUrl: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .optional()
    .meta({
      title: 'Imprint address',
      description: 'Where the imprint lives when it is not written below. http or https.',
      group: 'Contact',
    }),
  /** Logos by hash of an uploaded file; `dark` is for dark themes and falls back to `light`. */
  logos: z
    .strictObject({
      light: fileHash.optional().meta({ title: 'Logo for the light theme', widget: 'logo' }),
      dark: fileHash.optional().meta({
        title: 'Logo for the dark theme',
        description: 'Optional. Without one the light logo is used.',
        widget: 'logo',
      }),
    })
    .prefault({})
    .meta({ title: 'Logos' }),
  /**
   * The colours of both themes (M12a sprint 4): any daisyUI token, `#rrggbb` only. Unset tokens keep the built-in themes of the web
   * app. Every text and background pair must pass WCAG AA on save (the settings service checks it; `CONTRAST_PAIRS`).
   */
  colors: z
    .strictObject({ light: themeColors('light'), dark: themeColors('dark') })
    .prefault({})
    .meta({
      title: 'Colours',
      description:
        'The colours of the light and the dark theme. Leave a colour empty to keep the built-in one; leave a text colour empty to have black or white chosen for you. Every text must stay readable (WCAG AA, 4.5:1; 3:1 for focus rings): a set that fails is refused and the pair is named.',
    }),
  /** Markdown, rendered on the server and sanitised. Raw HTML in it shows as text. */
  legal: z
    .strictObject({
      terms: legalText.optional(),
      privacy: legalText.optional(),
      imprint: legalText.optional(),
    })
    .prefault({})
    .meta({
      title: 'Legal texts',
      description:
        'Markdown, shown on the legal pages. Start at level 2 headings (##): the page title is the first heading. Raw HTML shows as text. The privacy text should say that the id of a deleted account stays in the audit trail until the retention period ends.',
    }),
});

export const settingsSchema = z.strictObject({
  /** How the instance presents itself: names, sender, contact, logos and legal texts. */
  branding: brandingSchema.prefault({}).meta({ title: 'Branding' }),
  /**
   * Limits per client address (and per credential, and per session) for each route group. `strict` is for routes an
   * attacker gains from by repeating them: login, register, token use and creation.
   */
  rateLimits: z
    .strictObject({
      default: bucket.default({ ...DEFAULT_RATE_LIMITS.default }),
      strict: bucket.default({ ...DEFAULT_RATE_LIMITS.strict }),
    })
    .default({
      default: { ...DEFAULT_RATE_LIMITS.default },
      strict: { ...DEFAULT_RATE_LIMITS.strict },
    })
    .meta({
      title: 'Rate limits',
      description:
        'Requests per client address (and per credential, and per signed-in session) for each route group. "strict" is for routes an attacker gains from by repeating them: sign-in, registration, token use and creation.',
    }),
});

export type CoreSettings = z.output<typeof settingsSchema>;
