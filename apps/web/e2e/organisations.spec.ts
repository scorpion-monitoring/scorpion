import { expect, test } from './support/fixtures.ts';
import { adminApi, unique } from './support/admin.ts';

test('prototype: the JSON-LD block reaches the head, with a hostile name', async ({
  page,
  playwright,
  baseURL,
  at,
}) => {
  const api = await adminApi(playwright, baseURL, at);
  const name = `</script><script>window.pwned=1</script> <!-- & ${unique('o')}`;
  const created = await api.send('POST', '/organisations', {
    type: 'provider',
    abbreviation: unique('P'),
    name,
  });
  expect(created.status).toBe(201);
  const id = (created.body as { id: string }).id;
  const violations: string[] = [];
  page.on(
    'console',
    (m) => m.text().includes('Content Security Policy') && violations.push(m.text()),
  );
  const loginPage = await page.context().request.post(at('/api/internal/auth/login'), {
    data: { username: 'root', password: 'a long password for the admin' },
  });
  expect(loginPage.status()).toBe(200);
  const response = await page.goto(at(`/organisations/${id}`));
  const html = await response!.text();
  expect(html).toContain('application/ld+json');
  const text = await page.locator('head script[type="application/ld+json"]').textContent();
  expect((JSON.parse(text!) as { name: string }).name).toBe(name);
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
  ).toBeUndefined();
  expect(violations).toEqual([]);
});
