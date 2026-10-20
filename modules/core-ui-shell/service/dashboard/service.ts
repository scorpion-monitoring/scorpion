// The dashboard of the signed-in caller: read it repaired, save it validated. Own data only: no method takes
// a user id, the owner is the actor, and the document lives in the user-preference store of core.settings,
// which this module reaches through the public service (`getUserPreference`, `setUserPreference`) and never
// through the table. The plain permission is checked here again after the route's own check.
import { Invalid, Unauthorized, type Actor, type UserActor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { ModuleContext } from '@scorpion/kernel';
import {
  COLUMNS,
  DASHBOARD_SLOT,
  INSTANCE_ID,
  MAX_CONFIG_BYTES,
  MAX_ITEMS,
  MAX_PACKED_Y,
  MAX_ROWS,
} from '../../grid.ts';
import type { WidgetEntry } from '../../registries.ts';
import {
  defaultDashboard,
  pack,
  parseDashboard,
  serialiseDashboard,
  type DashboardContext,
  type DashboardItem,
  type DropReason,
  type PlaceableWidget,
  type ResetReason,
} from './document.ts';

export const PERMISSION_DASHBOARD_READ = 'core.ui-shell.dashboard.read';
export const PERMISSION_DASHBOARD_WRITE = 'core.ui-shell.dashboard.write';
/** The user preference that holds the document. The structural schema is `storedDashboardSchema`. */
export const DASHBOARD_PREFERENCE = 'core.ui-shell.dashboard';

export interface DashboardView {
  version: 1;
  /** What the page draws: repaired, only widgets the caller may see. By row, then column. */
  items: DashboardItem[];
  /** What the repair left out of the stored document, with a reason. Nothing is rewritten by a read. */
  dropped: { id: string; reason: DropReason }[];
  /** The stored document was replaced by the default dashboard. */
  reset: boolean;
  resetReason?: ResetReason;
  /** Nothing is stored (or what is stored cannot be read): `items` is the default dashboard. */
  isDefault: boolean;
}

export interface DashboardService {
  /** Needs `core.ui-shell.dashboard.read`. The caller's own dashboard, sanitised; the default when none is stored. */
  get(actor: Actor): Promise<DashboardView>;
  /**
   * Needs `core.ui-shell.dashboard.write`. Validates the tiles (`Invalid` naming `items[i].widget`, `.config`, ...
   * and never repeating a value), moves overlaps down, and stores the caller's own document. Answers what
   * a read now gives.
   */
  save(actor: Actor, items: readonly DashboardItem[]): Promise<DashboardView>;
}

export interface Problem {
  path: string;
  message: string;
}

export function createDashboardService(
  ctx: Pick<ModuleContext, 'registry'>,
  deps: {
    authz: Pick<AuthzService, 'can' | 'require'>;
    settings: Pick<SettingsService, 'getUserPreference' | 'setUserPreference'>;
  },
): DashboardService {
  const entries = ctx.registry('ui.widget') as WidgetEntry[];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  function owner(actor: Actor): UserActor {
    if (actor.kind !== 'user') throw new Unauthorized();
    return actor;
  }

  /** What the caller may see, decided once per permission and request. */
  async function contextFor(actor: Actor): Promise<DashboardContext> {
    const wanted = new Set<string>();
    for (const entry of entries) {
      if (
        entry.slot === DASHBOARD_SLOT &&
        entry.public !== true &&
        entry.permission !== undefined
      ) {
        wanted.add(entry.permission);
      }
    }
    const granted = new Set<string>();
    await Promise.all(
      [...wanted].map(async (permission) => {
        if (await deps.authz.can(actor, permission)) granted.add(permission);
      }),
    );
    return {
      entries,
      may: (entry: PlaceableWidget) => entry.public === true || granted.has(entry.permission!),
    };
  }

  /** The semantic checks of a save. Messages name the field and never repeat what the caller sent. */
  function problemsOf(items: readonly DashboardItem[], context: DashboardContext): Problem[] {
    const problems: Problem[] = [];
    const add = (path: string, message: string) => problems.push({ path, message });
    if (items.length > MAX_ITEMS) add('items', `Must have at most ${MAX_ITEMS} tiles.`);
    const ids = new Set<string>();
    const singletons = new Set<string>();
    items.forEach((item, i) => {
      const at = `items[${i}]`;
      if (!INSTANCE_ID.test(item.id)) {
        add(`${at}.id`, 'Must be 4 to 12 lower-case letters and digits.');
      } else if (ids.has(item.id)) {
        add(`${at}.id`, 'Must be unique on the dashboard.');
      }
      ids.add(item.id);
      const entry = byId.get(item.widget);
      if (entry === undefined || entry.slot !== DASHBOARD_SLOT || !context.may(entry)) {
        add(`${at}.widget`, 'Is not a widget you can place.');
        return;
      }
      if (entry.grid?.singleton === true) {
        if (singletons.has(entry.id)) add(`${at}.widget`, 'Can be placed only once.');
        singletons.add(entry.id);
      }
      const minW = entry.grid?.minW ?? 1;
      const maxW = Math.min(entry.grid?.maxW ?? COLUMNS, COLUMNS);
      const minH = entry.grid?.minH ?? 1;
      const maxH = Math.min(entry.grid?.maxH ?? MAX_ROWS, MAX_ROWS);
      if (!Number.isInteger(item.w) || item.w < minW || item.w > maxW) {
        add(`${at}.w`, `Must be a whole number from ${minW} to ${maxW}.`);
      }
      if (!Number.isInteger(item.h) || item.h < minH || item.h > maxH) {
        add(`${at}.h`, `Must be a whole number from ${minH} to ${maxH}.`);
      }
      if (!Number.isInteger(item.x) || item.x < 0 || item.x + item.w > COLUMNS) {
        add(`${at}.x`, `Must keep the tile inside the ${COLUMNS} columns.`);
      }
      if (!Number.isInteger(item.y) || item.y < 0 || item.y > MAX_PACKED_Y) {
        add(`${at}.y`, 'Must be a row inside the dashboard.');
      }
      const config = configProblem(entry, item.config);
      if (config) add(`${at}.config`, config);
    });
    return problems;
  }

  function configProblem(entry: WidgetEntry, config: unknown): string | undefined {
    let text: string;
    try {
      text = JSON.stringify(config ?? null);
    } catch {
      return 'Must be JSON.';
    }
    if (new TextEncoder().encode(text).length > MAX_CONFIG_BYTES) {
      return `Must be at most ${MAX_CONFIG_BYTES} bytes as JSON.`;
    }
    if (entry.configSchema === undefined) {
      return config !== null && typeof config === 'object' && Object.keys(config).length === 0
        ? undefined
        : 'This widget has no settings.';
    }
    try {
      const result = entry.configSchema.safeParse(config);
      if (!result.success) return 'Is not valid for this widget.';
      // Defaults can make it longer than what was sent.
      const stored = JSON.stringify(result.data);
      return stored !== undefined && new TextEncoder().encode(stored).length <= MAX_CONFIG_BYTES
        ? undefined
        : `Must be at most ${MAX_CONFIG_BYTES} bytes as JSON.`;
    } catch {
      return 'Is not valid for this widget.';
    }
  }

  function cleanConfig(entry: WidgetEntry, config: unknown): Record<string, unknown> {
    if (entry.configSchema === undefined) return {};
    const result = entry.configSchema.safeParse(config);
    return result.success
      ? (JSON.parse(JSON.stringify(result.data)) as Record<string, unknown>)
      : {};
  }

  return {
    async get(actor) {
      await deps.authz.require(actor, PERMISSION_DASHBOARD_READ);
      const { userId } = owner(actor);
      const context = await contextFor(actor);
      // `undefined`: nothing stored, or a document that no longer passes the preference's structural schema.
      const stored = await deps.settings.getUserPreference(userId, DASHBOARD_PREFERENCE);
      if (stored === undefined) {
        return {
          version: 1,
          items: defaultDashboard(entries, context.may),
          dropped: [],
          reset: false,
          isDefault: true,
        };
      }
      const parsed = parseDashboard(stored, context);
      return { version: 1, ...parsed, isDefault: false };
    },

    async save(actor, items) {
      await deps.authz.require(actor, PERMISSION_DASHBOARD_WRITE);
      owner(actor);
      const context = await contextFor(actor);
      const problems = problemsOf(items, context);
      if (problems.length > 0) throw new Invalid('The dashboard is not valid.', problems);
      // Store what each widget's schema made of the configuration (defaults applied, unknown keys gone).
      const clean = items.map((item) => ({
        ...item,
        config: cleanConfig(byId.get(item.widget)!, item.config),
      }));
      let document;
      try {
        document = serialiseDashboard(pack(clean));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        throw new Invalid('The dashboard is not valid.', [
          {
            path: 'items',
            message: 'Is too large to store; remove a tile or simplify its settings.',
          },
        ]);
      }
      await deps.settings.setUserPreference(actor, DASHBOARD_PREFERENCE, document);
      return { version: 1, ...parseDashboard(document, context), isDefault: false };
    },
  };
}
