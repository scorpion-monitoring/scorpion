import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { loadLegal } from './legal.ts';

function context(page: string, answer: Response): UiLoadContext {
  const api = {
    GET: async (path: string, init: { params: { path: { page: string } } }) => {
      expect(path).toBe('/legal/{page}');
      expect(init.params.path.page).toBe(page);
      const body = answer.headers.get('content-type')?.includes('json')
        ? await answer.clone().json()
        : undefined;
      return answer.ok ? { data: body, response: answer } : { error: body, response: answer };
    },
  };
  return { params: { page }, url: new URL('http://x/legal/' + page), api } as never;
}

describe('loadLegal', () => {
  it.each(['other', 'TERMS', 'terms.html', '..', ''])(
    'throws a 404 for the name %j without asking the API',
    async (page) => {
      const asked: string[] = [];
      const ctx = {
        params: { page },
        url: new URL('http://x/legal/' + page),
        api: { GET: (path: string) => asked.push(path) },
      } as never;
      await expect(loadLegal(ctx)).rejects.toMatchObject({ status: 404 });
      expect(asked).toEqual([]);
    },
  );

  it('returns the title and the HTML the API sanitised', async () => {
    const answer = Response.json({ page: 'terms', title: 'Terms of use', html: '<p>Be kind.</p>' });
    expect(await loadLegal(context('terms', answer))).toEqual({
      title: 'Terms of use',
      html: '<p>Be kind.</p>',
    });
  });

  it('throws for a text nobody wrote, and never returns a response (defect 12)', async () => {
    const answer = new Response(
      JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 }),
      {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      },
    );
    const outcome = loadLegal(context('privacy', answer));
    await expect(outcome).rejects.toBeInstanceOf(ApiError);
    await expect(outcome).rejects.toMatchObject({ status: 404 });
  });
});
