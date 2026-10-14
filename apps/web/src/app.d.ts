import type { ApiClient, Navigation, Session } from '@scorpion/contracts/client';
import type { Locale } from '@scorpion/ui-kit';

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  /** The address of the API reference's script below the base path; set by the build (src/front/scalar-asset-plugin.ts). */
  const __SCALAR_ASSET__: string;

  namespace App {
    interface Locals {
      /** The API client of this request: it forwards the caller's cookie and address. */
      api: ApiClient;
      /** The caller, `null` when nobody is signed in. Asked once per request. */
      session(): Promise<Session | null>;
      /** What the caller may see. Asked once per request. */
      navigation(): Promise<Navigation>;
      /** Whether the instance has no administrator yet (the start page then offers the first-admin form). */
      bootstrap(): Promise<boolean>;
      /** The language of this request (ADR-0022). Asked once per request. */
      locale(): Promise<Locale>;
    }
    interface Error {
      message: string;
      /** Quote this when you report a problem. */
      requestId?: string;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
