// The API reference (ADR-0038) as a browser sees it: what it asks for, what its policy refuses, what it
// keeps in the browser. Shared by the journey, the header test and the accessibility test.
import { expect, type Page } from '@playwright/test';

/**
 * The policy reports (`securitypolicyviolation`) the reference makes today, and no others. The bundle's Zod
 * tests whether it may compile validators with `try { Function('') } catch {}`; the policy has no `'unsafe-eval'`, so
 * the browser reports it, Zod falls back, and nothing is lost (ADR-0038). A new report after an upgrade of Scalar fails
 * the test that uses this list, which is the point.
 */
export const KNOWN_REPORTS = ['script-src eval'];

export interface Watch {
  /** Every address the page asked for, with the method. */
  requests: string[];
  /** The policy reports of the current document, as `<directive> <blocked>`. */
  reports: () => Promise<string[]>;
  /** The console messages that are about a policy. */
  policyMessages: string[];
}

/** Starts to record requests and policy reports; call before the first `goto`. */
export async function watch(page: Page): Promise<Watch> {
  const requests: string[] = [];
  const policyMessages: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('console', (message) => {
    if (/content security policy|refused to/i.test(message.text())) {
      policyMessages.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const reports: string[] = [];
    (window as unknown as { __reports: string[] }).__reports = reports;
    document.addEventListener('securitypolicyviolation', (event) => {
      reports.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return {
    requests,
    policyMessages,
    reports: () => page.evaluate(() => (window as unknown as { __reports: string[] }).__reports),
  };
}

/** Every request of `requests` goes to `origin`. */
export function expectNoForeignRequest(requests: string[], origin: string): void {
  expect(requests.filter((address) => !address.startsWith(`${origin}/`))).toEqual([]);
}

/** What the page keeps in the browser: web storage and the cookies, as one comparable value. */
export async function browserState(page: Page): Promise<string> {
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: Object.entries(localStorage).sort(),
      session: Object.entries(sessionStorage).sort(),
    }),
  );
  const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).sort();
  return JSON.stringify({ storage, cookies });
}

/** Opens the reference and waits until Scalar has drawn the routes. */
export async function openReference(page: Page, at: (path: string) => string): Promise<void> {
  await page.goto(at('/docs/reference'));
  await expect(page.getByRole('link', { name: 'List the providers' })).toBeVisible();
}

/**
 * Puts the token into Scalar's authentication, opens the call of one route and sends it. Returns the status
 * line and the body that Scalar shows.
 */
export async function callFromReference(
  page: Page,
  route: string,
  token: string,
): Promise<{ status: string; body: string }> {
  await page.getByRole('textbox', { name: 'Token' }).first().fill(token);
  await page.getByRole('link', { name: route }).first().click();
  // The route's own section holds its "Test Request" button.
  await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: route, level: 3 }) })
    .getByRole('button', { name: 'Test Request' })
    .click();
  const dialog = page.getByRole('dialog');
  // The dialog keeps its own copy of the token; set it too, so a call never goes out with the one before.
  const field = dialog.getByRole('textbox', { name: 'Token' }).first();
  await field.fill(token);
  await expect(field).toHaveValue(token);
  // The viewer keeps the answer of the call before until the new one arrives: wait for this call's own response,
  // then for the panel to show its status.
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'GET' &&
        candidate.url().includes('/api/v1/') &&
        !candidate.url().endsWith('/openapi.json'),
    ),
    dialog.getByRole('button', { name: /^Send/ }).first().click(),
  ]);
  const code = String(response.status());
  const status = dialog.getByText(`${code} `).first();
  await expect(status).toBeVisible();
  const line = await status.innerText();
  // A JSON answer is drawn in the code viewer; a plain-text one (Turtle) may not be, so fall back to the dialog's text.
  const viewer = dialog.locator('.cm-content');
  const body =
    (await viewer.count()) > 0 ? await viewer.last().innerText() : await dialog.innerText();
  await page.getByRole('button', { name: 'Close Client' }).click();
  return { status: line, body };
}
