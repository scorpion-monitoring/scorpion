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
  /** The typed client of this request: it forwards the caller's cookie and the client address. */
  api: ApiClient;
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
 * The widgets a module offers, by the `component` name of its `ui.widget` entries (registry of `core.ui-shell`):
 * the bell in the header, a card on the dashboard. A widget takes no props; it reads what it needs through
 * `getShell()` and the typed client, and draws nothing but what its permission allows. Every `ui` entry exports
 * `widgets` (an empty object when it has none), and names must be unique across the modules of a profile.
 */
export type UiWidgets = Record<
  string,
  () => Promise<{ default: Component<Record<string, never>> }>
>;
