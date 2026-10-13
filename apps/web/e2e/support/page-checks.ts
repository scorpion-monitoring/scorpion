// What the journeys that read a page's head share: the JSON-LD block, parsed, and the Content-Security-Policy
// violations the browser reports (a block that the policy refused would show here).
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** The profile in the `<script type="application/ld+json">` block of the head, parsed. */
export async function jsonLd(page: Page) {
  const block = page.locator('head script[type="application/ld+json"]');
  await expect(block).toHaveCount(1);
  return JSON.parse((await block.textContent())!) as Record<string, unknown> & {
    name: string;
    logo?: { url: string };
    contactPoint?: { email: string; contactType: string };
    sameAs?: string[];
  };
}

/** Collects the violations of the page's Content-Security-Policy, reported by the browser. */
export async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.violatedDirective}: ${event.blockedURI}`,
      ),
    );
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}
