// The icon block of a service (ui-kit's `ImageBlock`): its words and the two calls it makes. Used by the screen
// after a creation and by the edit form of the service page, so both say and do the same.
import { unwrap, type ApiClient } from '@scorpion/contracts/client';
import type { ImageBlockTexts } from '@scorpion/ui-kit';
import { MAX_ICON_MIB } from './limits.ts';

type T = (key: string, params?: Record<string, string | number>) => string;

/** The words of the block; the alt text names the service. */
export const iconTexts = (t: T, name: string): ImageBlockTexts => ({
  title: t('services.icon.title'),
  alt: t('services.icon.alt', { name }),
  none: t('services.icon.none'),
  choose: t('services.icon.choose'),
  hint: t('services.icon.hint', { count: MAX_ICON_MIB }),
  remove: t('services.icon.remove'),
  saved: t('services.icon.saved'),
  removed: t('services.icon.removed'),
  tooBig: t('services.icon.tooBig', { count: MAX_ICON_MIB }),
  invalid: t('services.icon.invalid'),
  forbidden: t('services.icon.forbidden'),
});

/** The image is the request body as it is; the server checks it, re-encodes it and answers with the stored file. */
export async function uploadIcon(
  api: ApiClient,
  id: string,
  file: File,
): Promise<string | undefined> {
  const saved = await unwrap(
    api.PUT('/services/{id}/icon', {
      params: { path: { id } },
      body: file as unknown as string,
      bodySerializer: (sent: unknown) => sent as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
    }),
  );
  return saved.iconUrl;
}

export async function removeIcon(api: ApiClient, id: string): Promise<void> {
  await unwrap(api.DELETE('/services/{id}/icon', { params: { path: { id } } }));
}
