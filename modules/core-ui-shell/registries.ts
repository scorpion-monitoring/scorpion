// The four registries the shell declares (ADR-0027). The entries are data: what the server needs to
// decide who may see a page or a link. The code of a page (its component and `load`) is the module's
// `ui` entry, which only the web app imports.
import { z } from 'zod';

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

/** A card of the dashboard. `component` names a component of the module's `ui` entry. */
export const widgetEntrySchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9.-]*$/),
    slot: z.string().regex(/^[a-z][a-z0-9-]*$/),
    component: z.string().min(1).max(100),
    order: z.number().int().default(100),
    permission: accessShape.permission,
    public: accessShape.public,
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
