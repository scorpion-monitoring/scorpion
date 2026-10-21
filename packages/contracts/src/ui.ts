// The browser half of a module's pages (ADR-0027). A module's `ui` entry (package export `./ui`) lists
// its pages as `UiRoute`s and its texts as `UiMessages`; the web app imports the entry through the file
// that `profile:generate` writes. Types only: this package holds no Svelte code.
import type { Component } from 'svelte';
import type { ApiClient } from './client.ts';
import type { OpenApiDocument } from './openapi.ts';

/** What a page's `load` may use. */
export interface UiLoadContext {
  /** The values of the `:param` segments of the matched path. */
  params: Readonly<Record<string, string>>;
  url: URL;
  /** The caller's language (`en`, `de`): for an API answer that carries labels in one language. Never a reason to choose what to show. */
  locale: string;
  /** The typed client of this request: it forwards the caller's cookie and the client address. */
  api: ApiClient;
  /**
   * Sends the visitor to another page of this application: `path` is below the base path (`/services/x`), the
   * shell adds the base. It throws SvelteKit's redirect (never returns a `Response`, defect 12), so a loader
   * calls it as `redirect('/services/x')` and nothing after it runs.
   */
  redirect: (path: string) => never;
  /** The OpenAPI document of the public API (v1) of this build, for the documentation page. */
  publicApi: OpenApiDocument;
}

// The data a page gets is whatever its own `load` returned, so a list of pages of different modules
// cannot name it; `any` is the honest type of that list, and each page types its own props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface UiRoute<Data = any> {
  /** One of the `path`s the module registered in `ui.routes`. */
  path: string;
  /**
   * Runs on the server, after the permission check. It throws (SvelteKit's `error(status, …)`, or an
   * `ApiError` from the client) when it cannot get its data, and never returns a `Response` (defect 12).
   */
  load?: (context: UiLoadContext) => Promise<Data> | Data;
  /** The page, imported lazily. It receives what `load` returned as `data`. */
  component: () => Promise<{
    default:
      | Component<{ data: Data; params: Record<string, string> }>
      // A page that shows nothing of its own data takes no props (Svelte types that as this).
      | Component<Record<string, never>>;
  }>;
}

/** Texts by locale and key: `{ en: { 'nav.home': 'Home' } }`. Keys are prefixed with the module's area. */
export type UiMessages = Record<string, Record<string, string>>;

/**
 * What a widget placed on the dashboard grid receives (M11). A widget that ignores them (the cards that predate
 * the grid, and the bell in the header, get none) works unchanged.
 */
export interface UiWidgetProps {
  /** The instance id of this tile: unique on the dashboard. */
  instance: string;
  /** The tile's own settings, validated and defaulted by the widget's `configSchema` on the server. */
  config: Record<string, unknown>;
  /** The dashboard is being edited: a widget may show its settings, and must not start anything the person did not ask for. */
  editing: boolean;
  /** Replaces the tile's settings; the dashboard saves them with the layout. */
  setConfig: (next: Record<string, unknown>) => void;
  /** The tile's size in grid units, which a chart may use to choose how much to draw. */
  size: { w: number; h: number };
}

/**
 * The widgets a module offers, by the `component` name of its `ui.widget` entries (registry of `core.ui-shell`):
 * the bell in the header, a card on the dashboard. A widget on the dashboard receives `UiWidgetProps` and may
 * ignore them; the others take no props. It reads what it needs through `getShell()` and the typed client, and
 * draws nothing but what its permission allows. Every `ui` entry exports `widgets` (an empty object when it has
 * none), and names must be unique across the modules of a profile.
 */
export type UiWidgets = Record<
  string,
  () => Promise<{ default: Component<Record<string, never>> | Component<UiWidgetProps> }>
>;
