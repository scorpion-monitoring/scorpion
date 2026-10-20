// The four registries the shell declares (ADR-0027). The entries are data: what the server needs to
// decide who may see a page or a link. The code of a page (its component and `load`) is the module's
// `ui` entry, which only the web app imports.
import { iconShapes } from '@scorpion/contracts/icons';
import { z } from 'zod';
import { COLUMNS, MAX_ROWS, MAX_Y } from './grid.ts';

/** A segment of a page path: a fixed word, or `:name` for one variable segment (`/users/:id`). */
const SEGMENT = /^(?:[a-z0-9][a-z0-9._~-]*|:[A-Za-z][A-Za-z0-9]*)$/;

export const pathSchema = z
  .string()
  .max(200)
  .refine(
    (path) =>
      path === '/' ||
      (path.startsWith('/') &&
        path
          .slice(1)
          .split('/')
          .every((s) => SEGMENT.test(s))),
    'must be "/" or a path of fixed lower-case words and ":params", with no trailing slash, "..", or encoded characters',
  );

/** Who may use an entry: a permission, or everyone with a reason that a reviewer reads (as `createRoute()`). */
const accessShape = {
  permission: z.string().min(1).optional(),
  public: z.literal(true).optional(),
  publicReason: z.string().trim().min(1).optional(),
};

function accessIsComplete(entry: {
  permission?: string;
  public?: true;
  publicReason?: string;
}): boolean {
  return entry.public === true
    ? entry.permission === undefined && entry.publicReason !== undefined
    : entry.permission !== undefined && entry.publicReason === undefined;
}
const ACCESS_MESSAGE = 'needs a permission, or public: true with a publicReason (and not both)';

/** A link or a card follows the access of the page it leads to; it only needs to say "everyone" or a permission. */
function linkAccessIsComplete(entry: { permission?: string; public?: true }): boolean {
  return (entry.public === true) !== (entry.permission !== undefined);
}
const LINK_ACCESS_MESSAGE = 'needs a permission, or public: true (and not both)';

/** A page of a module: `{ path, permission }` or `{ path, public: true, publicReason }`. */
export const routeEntrySchema = z
  .strictObject({ path: pathSchema, ...accessShape })
  .refine(accessIsComplete, ACCESS_MESSAGE);

/** A link in the navigation. `label` is a key of the message catalogue, not text. */
export const navEntrySchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9.-]*$/, 'a lower-case id such as "admin.users"'),
    label: z.string().min(1).max(100),
    path: pathSchema,
    icon: z.string().min(1).max(40).optional(),
    section: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a lower-case section id such as "admin"'),
    order: z.number().int().default(100),
    permission: accessShape.permission,
    public: accessShape.public,
  })
  .refine(linkAccessIsComplete, LINK_ACCESS_MESSAGE);

const dimension = (max: number) => z.number().int().min(1).max(max);

/**
 * Where a widget may sit on the dashboard grid (twelve columns) and how big it is: `w` and `h` are its size
 * when a person adds it, `min*` and `max*` bound what they may resize it to, and `default` puts it on the
 * dashboard of a person who has stored none. A widget that may be placed once says `singleton`.
 */
export const widgetGridSchema = z
  .strictObject({
    w: dimension(COLUMNS),
    h: dimension(MAX_ROWS),
    minW: dimension(COLUMNS).optional(),
    minH: dimension(MAX_ROWS).optional(),
    maxW: dimension(COLUMNS).optional(),
    maxH: dimension(MAX_ROWS).optional(),
    default: z
      .strictObject({
        x: z
          .number()
          .int()
          .min(0)
          .max(COLUMNS - 1),
        y: z.number().int().min(0).max(MAX_Y),
        w: dimension(COLUMNS),
        h: dimension(MAX_ROWS),
      })
      .optional(),
    singleton: z.boolean().optional(),
  })
  .superRefine((grid, ctx) => {
    const problem = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    for (const [axis, size, min, max] of [
      ['w', grid.w, grid.minW, grid.maxW],
      ['h', grid.h, grid.minH, grid.maxH],
    ] as const) {
      const [lo, hi] = [`min${axis.toUpperCase()}`, `max${axis.toUpperCase()}`];
      if (min !== undefined && max !== undefined && min > max) {
        problem([lo], `${lo} must not exceed ${hi}`);
      }
      if (min !== undefined && size < min) problem([axis], `${axis} must not be below ${lo}`);
      if (max !== undefined && size > max) problem([axis], `${axis} must not exceed ${hi}`);
      const placed = grid.default?.[axis];
      if (placed !== undefined && min !== undefined && placed < min) {
        problem(['default', axis], `default.${axis} must not be below ${lo}`);
      }
      if (placed !== undefined && max !== undefined && placed > max) {
        problem(['default', axis], `default.${axis} must not exceed ${hi}`);
      }
    }
    if (grid.default && grid.default.x + grid.default.w > COLUMNS) {
      problem(['default'], `default must fit the ${COLUMNS} columns (x + w <= ${COLUMNS})`);
    }
  });

const iconName = z
  .string()
  .min(1)
  .max(40)
  .refine((name) => Object.hasOwn(iconShapes, name), 'must be a name of the icon table');

/**
 * A card of the dashboard. `component` names a component of the module's `ui` entry. Since M11 an entry of the
 * slot `dashboard` can also be a tile of the widget grid: `grid` says where and how big, `label` and
 * `description` (keys of the module's message catalogue) and `icon` name it in the menu that adds it, and
 * `configSchema` validates and defaults the configuration each placed instance carries. All of them are
 * optional, so an entry without them stays valid and is placed at the default size.
 */
export const widgetEntrySchema = z
  .strictObject({
    id: z
      .string()
      .max(100)
      .regex(/^[a-z][a-z0-9.-]*$/),
    slot: z.string().regex(/^[a-z][a-z0-9-]*$/),
    component: z.string().min(1).max(100),
    order: z.number().int().default(100),
    permission: accessShape.permission,
    public: accessShape.public,
    grid: widgetGridSchema.optional(),
    label: z.string().min(1).max(100).optional(),
    description: z.string().min(1).max(200).optional(),
    icon: iconName.optional(),
    configSchema: z
      .custom<z.ZodType>((value) => value instanceof z.ZodType, 'expected a Zod schema')
      .optional(),
  })
  .refine(linkAccessIsComplete, LINK_ACCESS_MESSAGE);

/** A colour theme the user can pick; `id` is the DaisyUI theme name. */
export const themeEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1).max(100),
  colorScheme: z.enum(['light', 'dark']),
});

export type RouteEntry = z.output<typeof routeEntrySchema>;
export type NavEntry = z.output<typeof navEntrySchema>;
export type WidgetEntry = z.output<typeof widgetEntrySchema>;
export type ThemeEntry = z.output<typeof themeEntrySchema>;

export const REGISTRIES = {
  'ui.routes': routeEntrySchema,
  'ui.nav': navEntrySchema,
  'ui.widget': widgetEntrySchema,
  'ui.theme': themeEntrySchema,
} as const;
