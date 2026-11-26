import type { Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import { adminApi, apiAs, newPerson, unique, type AdminApi } from './support/admin.ts';
import { withDb } from './support/db.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import {
  makeOrg,
  memberOf,
  pageAs,
  prefixOf,
  toast,
  uniqueAbbreviation,
} from './support/members.ts';

// M16 sprint 3: the section "Publications" of the service page and the Bibliographic KPI setting, with the stub adapters of the
// server (`NODE_ENV=test`: doi.org knows no DOI, OpenAlex knows none). A member adds a publication, meets the duplicate and the bad
// DOI at the field, checks the citations now and is refused the second time, and removes one after a confirmation; a person of
// another provider reads without a control that writes; the metadata, the counts and the history come from rows the test writes
// into the stack's database (the stubs know nothing). Every test makes its own provider, service and DOIs (specs share a
// database), and runs under `/` and under the two-segment `/a/b` (defect 11). The calls the section makes are printed as
// `[biblio-calls]` lines and written into the report.

const suffix = () => Math.random().toString(36).slice(2, 8);

/** A service of a new provider, a member of it, and a signed-in person of another provider. */
async function world(
  playwright: Parameters<typeof adminApi>[0],
  baseURL: string | undefined,
  at: (path: string) => string,
) {
  const api = await adminApi(playwright, baseURL, at);
  const tag = unique('bib');
  const provider = await makeOrg(api, uniqueAbbreviation('BIB'));
  const elsewhere = await makeOrg(api, uniqueAbbreviation('BIX'));
  const made = await api.send('POST', '/services', {
    slug: `${tag}-svc`,
    name: `${tag} Cited service`,
    provider: provider.id,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const service = {
    id: (made.body as { id: string }).id,
    slug: `${tag}-svc`,
    name: `${tag} Cited service`,
  };
  const member = newPerson('bibmem');
  await memberOf(api, playwright, baseURL, at, member, provider);
  const stranger = newPerson('bibout');
  await memberOf(api, playwright, baseURL, at, stranger, elsewhere);
  return { api, tag, service, member, stranger };
}

/** A DOI no other test uses, under the Crossref test prefix. */
const newDoi = (tag: string) => `10.5555/${tag}-${suffix()}`;

/** Adds a publication through the API as the administrator. */
async function addThroughApi(api: AdminApi, serviceId: string, doi: string) {
  const added = await api.send('POST', `/bibliometrics/services/${serviceId}/publications`, {
    doi,
  });
  expect(added.status, JSON.stringify(added.body)).toBe(201);
  return (added.body as { id: string }).id;
}

/**
 * What the stubs cannot give: the metadata of a DOI, as doi.org would have answered, and its citation counts, as two weekly runs of
 * OpenAlex would have stored them (oldest first).
 */
async function describeDoi(
  basePath: string,
  doi: string,
  metadata: {
    title: string;
    authors: string[];
    issued: string;
    precision: 'year' | 'month' | 'day';
    container: string;
  },
  counts: { count: number; at: string }[],
) {
  await withDb(basePath, async (client) => {
    await client.query(
      `update biblio_doi_metadata
          set status = 'ok', reason = null, title = $2, authors = $3::jsonb, issued = $4, issued_precision = $5,
              container = $6, type = 'journal-article'
        where doi = $1`,
      [
        doi,
        metadata.title,
        JSON.stringify(metadata.authors),
        metadata.issued,
        metadata.precision,
        metadata.container,
      ],
    );
    for (const { count, at } of counts) {
      const run = await client.query<{ id: string }>(
        `insert into biblio_citation_run (id, trigger, source, started_at, finished_at, asked, found)
         values (gen_random_uuid(), 'schedule', 'openalex', $1, $1, 1, 1) returning id`,
        [at],
      );
      await client.query(
        `insert into biblio_citation_snapshot (run_id, doi, source, cited_by_count, taken_at)
         values ($1, $2, 'openalex', $3, $4)`,
        [run.rows[0]!.id, doi, count, at],
      );
    }
  });
}

const section = (page: Page) => page.getByTestId('service-publications');

test.describe('the publications of a service', () => {
  test('a member adds one, meets a duplicate and a bad DOI at the field, checks now, and removes one after a confirmation', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    await page.goto(at(`/services/${w.service.slug}`));
    await expect(
      section(page).getByRole('heading', { name: 'Publications', level: 2 }),
    ).toBeVisible();
    await expect(section(page).getByText('No publications yet.')).toBeVisible();
    await expect(section(page).getByText('No citation counts yet.')).toBeVisible();
    // Nothing to check yet.
    await expect(section(page).getByRole('button', { name: 'Check citations now' })).toBeDisabled();

    // Add: doi.org (the stub) does not know it, so the DOI stands for the title, and the add still succeeds.
    const doi = newDoi(w.tag);
    const field = section(page).getByLabel('DOI', { exact: true });
    await field.fill(`https://doi.org/${doi}`);
    await section(page).getByRole('button', { name: 'Add publication' }).click();
    await expect(toast(page).getByText(`${doi} was added.`)).toBeVisible();
    const row = section(page).getByTestId('publication').filter({ hasText: doi });
    await expect(row.getByRole('link', { name: doi })).toHaveAttribute(
      'href',
      `https://doi.org/${doi}`,
    );
    await expect(row.getByText('doi.org does not know this DOI')).toBeVisible();
    await expect(row.getByText('not found in OpenAlex')).toBeVisible();
    await expect(field).toHaveValue('');

    // The same DOI in another spelling is a duplicate (409), shown at the field.
    await field.fill(`doi:${doi.toUpperCase()}`);
    await section(page).getByRole('button', { name: 'Add publication' }).click();
    await expect(section(page).getByText('This service lists this DOI already.')).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    // Not a DOI (422), at the field too.
    await field.fill('not a doi');
    await section(page).getByRole('button', { name: 'Add publication' }).click();
    await expect(section(page).getByText('This service lists this DOI already.')).toHaveCount(0);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(section(page).getByTestId('publication')).toHaveCount(1);

    // Check now: queued (202); a second check within ten minutes is refused with the wait.
    await section(page).getByRole('button', { name: 'Check citations now' }).click();
    await expect(
      section(page).getByRole('status').getByText('The check is queued.', { exact: false }),
    ).toBeVisible();
    await section(page).getByRole('button', { name: 'Check citations now' }).click();
    await expect(
      section(page).getByText(/checked recently\. Try again in \d+ minutes?\./),
    ).toBeVisible();

    // Remove, after a confirmation; cancelling first keeps it.
    await row.getByRole('button', { name: `Remove ${doi}` }).click();
    const dialog = page.getByRole('dialog', { name: `Remove ${doi}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Remove ${doi}` }).click();
    await page
      .getByRole('dialog', { name: `Remove ${doi}?` })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(toast(page).getByText(`${doi} was removed.`)).toBeVisible();
    await expect(section(page).getByText('No publications yet.')).toBeVisible();
    // The focus is not lost with the removed row: it is on the heading of the section.
    await expect(
      section(page).getByRole('heading', { name: 'Publications', level: 2 }),
    ).toBeFocused();
    await opened.close();
    await w.api.dispose();
  });

  test('shows the metadata, the counts with their date, "not found", the total, five per page and the history', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const known = newDoi(w.tag);
    await addThroughApi(w.api, w.service.id, known);
    const title = `A well cited paper ${w.tag}`;
    await describeDoi(
      basePath,
      known,
      {
        title,
        authors: ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Edsger Dijkstra'],
        issued: '2020-09-01',
        precision: 'month',
        container: 'Journal of Tests',
      },
      [
        { count: 300, at: '2026-05-04T04:00:00Z' },
        { count: 312, at: '2026-05-11T04:00:00Z' },
      ],
    );
    // Five more, newer than the cited one (by their issued date), so the cited one goes to the second page.
    for (let i = 0; i < 5; i++) {
      const doi = newDoi(w.tag);
      await addThroughApi(w.api, w.service.id, doi);
      await describeDoi(
        basePath,
        doi,
        {
          title: `Newer paper ${i} ${w.tag}`,
          authors: ['Solo Author'],
          issued: `2024-0${i + 1}-15`,
          precision: 'day',
          container: 'Zenodo',
        },
        [],
      );
    }

    const opened = await pageAs(browser, baseURL, at, w.stranger);
    const page = opened.page;
    await page.goto(at(`/services/${w.service.slug}`));
    await expect(section(page).getByTestId('publications-total')).toHaveText(
      '312 citations, 1 of 6 publications found',
    );
    await expect(section(page).getByTestId('publication')).toHaveCount(5);
    await expect(section(page).getByText(`Newer paper 4 ${w.tag}`)).toBeVisible();
    await expect(section(page).getByText('January 15, 2024')).toBeVisible();
    await expect(section(page).getByText('not found in OpenAlex').first()).toBeVisible();

    await section(page).getByRole('button', { name: 'Next' }).click();
    const cited = section(page).getByTestId('publication').filter({ hasText: title });
    await expect(cited).toBeVisible();
    await expect(cited.getByText('Ada Lovelace et al.')).toBeVisible();
    await expect(cited.getByText('September 2020')).toBeVisible();
    await expect(cited.getByText('Journal of Tests')).toBeVisible();
    await expect(cited.getByText('Citations: 312')).toBeVisible();
    await expect(cited.getByText('as of May 11, 2026')).toBeVisible();
    await expect(cited.getByRole('link', { name: title })).toHaveAttribute(
      'href',
      `https://doi.org/${known}`,
    );

    // The history on demand, through the chart adapter, with its name for a screen reader.
    const toggle = cited.getByRole('button', { name: `Citation history of ${title}` });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(cited.getByRole('img', { name: `Citations of ${title} over time` })).toBeVisible();
    await expect(cited.getByRole('button', { name: 'Hide the history' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await opened.close();
    await w.api.dispose();
  });

  test('a person of another provider reads the publications without a control that writes', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const w = await world(playwright, baseURL, at);
    const doi = newDoi(w.tag);
    await addThroughApi(w.api, w.service.id, doi);
    const opened = await pageAs(browser, baseURL, at, w.stranger);
    const page = opened.page;
    await page.goto(at(`/services/${w.service.slug}`));
    await expect(section(page).getByRole('link', { name: doi })).toBeVisible();
    await expect(section(page).getByRole('button', { name: 'Add publication' })).toHaveCount(0);
    await expect(section(page).getByLabel('DOI', { exact: true })).toHaveCount(0);
    await expect(section(page).getByRole('button', { name: 'Check citations now' })).toHaveCount(0);
    await expect(section(page).getByRole('button', { name: `Remove ${doi}` })).toHaveCount(0);
    await expect(section(page).getByTestId('publication-controls')).toHaveCount(0);
    // The server refuses what the page does not offer.
    const theirs = await apiAs(playwright, baseURL, at, w.stranger);
    const tried = await theirs.send(
      'POST',
      `/bibliometrics/services/${w.service.id}/citations/refresh`,
    );
    expect(tried.status).toBe(403);
    const added = await theirs.send(
      'POST',
      `/bibliometrics/services/${w.service.id}/publications`,
      {
        doi: newDoi(w.tag),
      },
    );
    expect(added.status).toBe(403);
    await theirs.dispose();
    await opened.close();
    await w.api.dispose();
  });

  test('[defect-11] makes its calls and links under the base path, and adds one call to the service page', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    const w = await world(playwright, baseURL, at);
    await addThroughApi(w.api, w.service.id, newDoi(w.tag));
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    // Signing in left the person on the start page, whose widgets may still be reading: leave it, so only this page's calls count.
    await page.goto('about:blank');
    const seen: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/api/')) seen.push(`${request.method()} ${path}`);
    });
    await page.goto(at(`/services/${w.service.slug}`));
    await expect(section(page).getByTestId('publication')).toHaveCount(1);
    const prefix = `${prefixOf(basePath)}/api/internal/bibliometrics/`;
    const biblio = seen.filter((call) => call.includes('/bibliometrics/'));
    test.info().annotations.push({ type: 'service page', description: biblio.join(' | ') });
    console.log(`[biblio-calls] service page (${basePath}): ${biblio.join(' | ')}`);
    console.log(`[biblio-calls] service page, every API call (${basePath}): ${seen.length}`);
    // One read of the list; the history is read only when it is opened.
    expect(biblio).toEqual([`GET ${prefix}services/${w.service.id}/publications`]);
    // Every call of the page goes under the base path.
    for (const call of seen)
      expect(call.split(' ')[1]!.startsWith(`${prefixOf(basePath)}/api/`), call).toBe(true);

    // Opening one history is one more call.
    seen.length = 0;
    await section(page)
      .getByRole('button', { name: /^Citation history of / })
      .click();
    await expect(section(page).getByText('No counts yet.')).toBeVisible();
    const onOpen = seen.filter((call) => call.includes('/bibliometrics/'));
    console.log(`[biblio-calls] one history opened (${basePath}): ${onOpen.join(' | ')}`);
    expect(onOpen).toHaveLength(1);
    expect(onOpen[0]!.startsWith(`GET ${prefix}services/${w.service.id}/publications/`)).toBe(true);
    await opened.close();
    await w.api.dispose();
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the publications section, ${scheme} theme`, () => {
    test('has no serious violation with the controls, a field error, an open history and the remove dialog', async ({
      browser,
      playwright,
      baseURL,
      at,
      basePath,
    }) => {
      test.slow();
      const w = await world(playwright, baseURL, at);
      const doi = newDoi(w.tag);
      await addThroughApi(w.api, w.service.id, doi);
      const title = `An accessible paper ${w.tag}`;
      await describeDoi(
        basePath,
        doi,
        {
          title,
          authors: ['Ada Lovelace'],
          issued: '2021-01-01',
          precision: 'year',
          container: 'Journal of Tests',
        },
        [
          { count: 5, at: '2026-05-04T04:00:00Z' },
          { count: 7, at: '2026-05-11T04:00:00Z' },
        ],
      );
      const opened = await pageAs(browser, baseURL, at, w.member);
      const page = opened.page;
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(at(`/services/${w.service.slug}`));
      await expect(section(page).getByText(title)).toBeVisible();
      const clean = async (what: string) =>
        expect(await violations(page, '[data-testid="service-publications"]'), what).toEqual([]);
      await clean('the section with its controls');

      await section(page).getByLabel('DOI', { exact: true }).fill(doi);
      await section(page).getByRole('button', { name: 'Add publication' }).click();
      await expect(section(page).getByText('This service lists this DOI already.')).toBeVisible();
      await clean('a duplicate at the field');

      await section(page)
        .getByRole('button', { name: `Citation history of ${title}` })
        .click();
      await expect(
        section(page).getByRole('img', { name: `Citations of ${title} over time` }),
      ).toBeVisible();
      await clean('an open history');

      // By keyboard: the remove button opens the dialog, Escape closes it.
      await section(page)
        .getByRole('button', { name: `Remove ${title}` })
        .focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: `Remove ${title}?` });
      await expect(dialog).toBeVisible();
      expect(await violations(page, 'dialog[open]'), 'the remove dialog').toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await opened.close();
      await w.api.dispose();
    });
  });
}

test.describe('the Bibliographic KPI setting', () => {
  test('offers only numeric indicators in Bibliographic, saves one, and the server refuses another with a 422 at the field', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const tag = unique('bkpi');
    const indicator = async (name: string, body: Record<string, unknown>) => {
      const made = await api.send('POST', '/kpi/indicators', { name: `${name} ${tag}`, ...body });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      return { id: (made.body as { id: string }).id, name: `${name} ${tag}` };
    };
    const citations = await indicator('Citations', {
      valueType: 'integer',
      thematic: 'Bibliographic',
    });
    const visits = await indicator('Visits', { valueType: 'integer', thematic: 'Usage' });
    const remark = await indicator('Remark', {
      valueType: 'text',
      thematic: 'Bibliographic',
      qualitative: true,
    });
    const before = await api.get<{ version: number; values: Record<string, unknown> }>(
      '/settings/bibliometrics',
    );
    try {
      // The server: another indicator is a 422 naming the field, whatever sends it.
      for (const wrong of [visits.id, remark.id]) {
        const refused = await api.send('PUT', '/settings/bibliometrics', {
          version: before.version,
          values: { kpi: { indicatorId: wrong } },
        });
        expect(refused.status, JSON.stringify(refused.body)).toBe(422);
        expect(JSON.stringify(refused.body)).toContain('values.kpi.indicatorId');
      }

      // The page: the picker offers the numeric Bibliographic one and not the others.
      await signInThroughPage(page, at, admin);
      await page.goto(at('/admin/settings/bibliometrics'));
      await expect(
        page.getByRole('heading', { name: 'Publications and citations', level: 1 }),
      ).toBeVisible();
      const picker = page.getByLabel('Bibliographic KPI');
      await expect(picker).toBeEnabled();
      await expect(picker.locator('option', { hasText: citations.name })).toHaveCount(1);
      await expect(picker.locator('option', { hasText: visits.name })).toHaveCount(0);
      await expect(picker.locator('option', { hasText: remark.name })).toHaveCount(0);
      await picker.selectOption({ label: citations.name });
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page).getByText('The settings were saved.')).toBeVisible();
      const after = await api.get<{ values: { kpi: { indicatorId?: string } } }>(
        '/settings/bibliometrics',
      );
      expect(after.values.kpi.indicatorId).toBe(citations.id);
      await page.reload();
      await expect(page.getByLabel('Bibliographic KPI')).toHaveValue(citations.id);
      expect(await violations(page), 'the settings page with the picker').toEqual([]);
    } finally {
      // The stack is shared: the KPI goes back off.
      const current = await api.get<{ version: number }>('/settings/bibliometrics');
      await api.send('PUT', '/settings/bibliometrics', {
        version: current.version,
        values: before.values,
      });
      await api.dispose();
    }
  });
});
