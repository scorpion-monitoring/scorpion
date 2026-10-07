import type { ApiClient, Navigation, Session } from '@scorpion/contracts/client';

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      /** The API client of this request: it forwards the caller's cookie and address. */
      api: ApiClient;
      /** The caller, `null` when nobody is signed in. Asked once per request. */
      session(): Promise<Session | null>;
      /** What the caller may see. Asked once per request. */
      navigation(): Promise<Navigation>;
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
