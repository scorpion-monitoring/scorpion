// The JSON-LD block of the organisation page (ADR-0033, Decision 17): `JsonLd.svelte` is the one place that
// writes organisation data into the document without Svelte's escaping, so the output is tested with
// hostile data. The block must end up in the head, hold exactly the JSON, and never contain an element,
// a comment or a script of its own.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

// The component belongs to the module, and the module boundary rule allows no import of a module's internals
// from the web app. The test loads the file by its path, the way the web app's build finds it.
const { default: JsonLd } = (await import(
  /* @vite-ignore */ new URL(
    '../../../modules/registry-organisations/ui/JsonLd.svelte',
    import.meta.url,
  ).pathname
)) as { default: Component<{ profile: unknown }> };

const HOSTILE = [
  '</script><script>alert(1)</script>',
  '<!-- comment -->',
  '--> <script>',
  '<img src=x onerror=alert(1)>',
  'a & b &amp; &lt;',
  'quote " and \' and \\',
  'line\u2028separator\u2029paragraph',
  'lone \ud800 surrogate',
  '</SCRIPT >',
];

/** The text of the one `<script type="application/ld+json">` of `head`, and what is left when it is cut out. */
function block(head: string) {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head);
  return { text: match?.[1], rest: match ? head.replace(match[0], '') : head };
}

describe('JsonLd.svelte', () => {
  it.each(HOSTILE)(
    'writes %j as data into the head: no extra element, the JSON parses back',
    (hostile) => {
      const profile = { '@context': 'https://schema.org', '@type': 'Organization', name: hostile };
      const { head, body } = render(JsonLd, { props: { profile } });
      expect(body).not.toContain('ld+json');
      const { text, rest } = block(head);
      expect(text).toBeDefined();
      // The text of the block holds no character that could end it or open a comment.
      expect(text).not.toMatch(/[<>&\u2028\u2029]/);
      expect(JSON.parse(text!)).toEqual(profile);
      // Nothing but the block itself (and Svelte's own hydration markers) is in the head.
      expect(rest).not.toMatch(/<script/i);
      expect(rest).not.toContain(hostile);
      expect(rest).toMatch(/^(?:<!--[^<>]*-->)*$/);
    },
  );

  it('writes the whole profile of a real organisation, nested values included', () => {
    const profile = {
      '@context': 'https://schema.org',
      '@type': 'ResearchOrganization',
      '@id': 'https://scorpion.example/a/b/organisations/1',
      name: 'Leibniz IPK',
      sameAs: ['https://ror.org/02skbsp27', 'https://example.org/?a=1&b=2'],
      logo: { '@type': 'ImageObject', url: 'https://scorpion.example/a/b/api/internal/files/abc' },
      contactPoint: { '@type': 'ContactPoint', email: 'info@example.org', contactType: 'support' },
    };
    const { head } = render(JsonLd, { props: { profile } });
    expect(JSON.parse(block(head).text!)).toEqual(profile);
  });
});
