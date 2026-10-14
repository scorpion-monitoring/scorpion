// The landing page of the API documentation (`/docs`), rendered on the server with a stand-in for the shell. It
// is public, so it is drawn as an anonymous visitor would see it: the harness throws if it reads the session.
// What a person needs before the reference: the way to a token, the permission of each route (from the build's
// OpenAPI document), the address of that document, and a link to the reference that makes a full load.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ShellHarness from './test/ShellHarness.svelte';

// The page belongs to the module, so it is loaded by path, as in catalogue-page.test.ts.
const ui = (file: string) =>
  import(
    /* @vite-ignore */ new URL(`../../../modules/core-ui-shell/ui/${file}`, import.meta.url)
      .pathname
  );
const { messages } = (await ui('messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const Docs = ((await ui('Docs.svelte')) as { default: Component }).default;

const draw = (data: unknown, locale = 'en') =>
  render(ShellHarness, {
    props: { page: Docs, data, userId: null, messages, locale, anonymousOnly: true },
  }).body;

const operations = [
  {
    method: 'get',
    path: '/providers',
    summary: 'List the providers',
    public: false,
    permission: 'registry.organisations.v1.read',
  },
  {
    method: 'get',
    path: '/openapi.json',
    summary: 'The description',
    public: true,
    permission: null,
  },
];
const data = { operations, scopes: ['registry.organisations.v1.read'] };

describe('the landing page of the API documentation', () => {
  it('links to the reference and to the document with a full page load', () => {
    const html = draw(data);
    expect(html).toContain('href="/docs/reference" data-sveltekit-reload');
    expect(html).toContain('href="/api/v1/openapi.json" data-sveltekit-reload');
  });

  it('says how to get a token, with the profile page and both ways to send it', () => {
    const html = draw(data);
    expect(html).toContain('href="/profile"');
    expect(html).toContain('Get a token');
    expect(html).toContain('Authorization: Bearer &lt;token>');
    expect(html).toContain('X-API-Key: &lt;token>');
  });

  it('names the permission of each route, and says "public" for the one that needs none', () => {
    const html = draw(data);
    expect(html).toContain('<code class="num">registry.organisations.v1.read</code>');
    expect(html).toContain('/providers');
    expect(html).toContain('Public');
    expect(html).toContain('list of allowed origins');
  });

  it('says so when the build has no route', () => {
    expect(draw({ operations: [], scopes: [] })).toContain('has no routes yet');
  });

  it('is in German for a German visitor', () => {
    const html = draw(data, 'de');
    expect(html).toContain('API-Referenz öffnen');
    expect(html).toContain('Ein Token erhalten');
    expect(html).toContain('Berechtigung');
    expect(html).not.toContain('Open the API reference');
  });

  it('names no address of another origin', () => {
    const html = draw(data);
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });
});
