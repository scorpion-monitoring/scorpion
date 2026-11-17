import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Branding } from '@scorpion/contracts/client';
import { shellMessages } from './lib/messages.ts';
import { SOFTWARE } from './lib/software.ts';
import FooterPage from './test/FooterPage.svelte';
import ShellHarness from './test/ShellHarness.svelte';

// The footer (M12a, sprint 1, item 7): `© year instance name` from the settings, and the software's own attribution
// next to it, which no setting changes and no operator can remove (ADR-0050).
const branding = (name: string): Branding =>
  ({
    instanceName: name,
    productName: 'Whatever',
    logos: { light: null, dark: null },
    legalPages: [],
    imprintUrl: null,
    contactEmail: null,
    senderName: 'x',
    senderAddress: 'x@example.org',
    publicUrl: 'https://example.org',
  }) as unknown as Branding;

const draw = (name: string, locale = 'en') =>
  render(ShellHarness, {
    props: {
      page: FooterPage,
      data: branding(name),
      userId: null,
      messages: shellMessages,
      locale,
    },
  }).body;

describe('the footer', () => {
  it('names the instance in the copyright, whatever the instance is called', () => {
    const year = new Date().getFullYear();
    for (const name of ['de.NBI', 'NFDI4Plants', 'A & B <Registry']) {
      const html = draw(name);
      const shown = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
      expect(html, name).toContain(`© ${year} ${shown}`);
    }
  });

  it('always carries the attribution with the version and a link to the licence, whatever the branding says', () => {
    for (const name of ['Scorpion', 'Some Other Name', '']) {
      const html = draw(name);
      expect(html, name).toContain('data-testid="software-attribution"');
      expect(html, name).toContain('Powered by');
      expect(html, name).toContain(`href="${SOFTWARE.url}"`);
      expect(html, name).toContain(`href="${SOFTWARE.licenceUrl}"`);
      expect(html, name).toContain('ISC licence');
      expect(html, name).toContain(` ${SOFTWARE.version} `);
    }
  });

  it('has the version of the root package, not a placeholder', () => {
    const { version } = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(SOFTWARE.version).toBe(version);
    expect(SOFTWARE.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('opens the external links safely and is translated', () => {
    const html = draw('x', 'de');
    expect(html).toContain('Betrieben mit');
    expect(html).toContain('Lizenz: ISC');
    expect(html.match(/rel="noopener noreferrer"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('has no setting behind the attribution: the settings schema names no such field', () => {
    const schema = readFileSync(
      new URL('../../../modules/core-settings/settings-schema.ts', import.meta.url),
      'utf8',
    );
    expect(schema).not.toMatch(/attribution|poweredBy|softwareVersion/i);
  });
});
