<script lang="ts">
  // The logo of one organisation: a thin use of the shared `ImageBlock`. It names the two calls
  // (`PUT` and `DELETE /organisations/{id}/logo`) and the words; the block shows, uploads, replaces and
  // removes. Shared by the administrator's editor and the manager's form: what the caller may do is decided
  // by the server, and a 403 is shown in words.
  import { ImageBlock, getShell } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { MAX_LOGO_BYTES, MAX_LOGO_MIB } from './limits.ts';

  let {
    organisation,
    editable = true,
    onchanged,
  }: {
    organisation: { id: string; name: string; logoUrl?: string | undefined };
    editable?: boolean;
    /** Called with the new logo URL (absent after a removal). */
    onchanged?: (logoUrl: string | undefined) => void;
  } = $props();
  const { t, api } = getShell();

  const texts = $derived({
    title: t('organisation.logo.title'),
    alt: t('organisation.logo.alt', { name: organisation.name }),
    none: t('organisation.logo.none'),
    choose: t('organisation.logo.choose'),
    hint: t('organisation.logo.hint', { count: MAX_LOGO_MIB }),
    remove: t('organisation.logo.remove'),
    saved: t('organisation.logo.saved'),
    removed: t('organisation.logo.removed'),
    tooBig: t('organisation.logo.tooBig', { count: MAX_LOGO_MIB }),
    invalid: t('organisation.logo.invalid'),
    forbidden: t('organisation.logo.forbidden'),
  });

  // The image is the request body as it is; the server checks it, re-encodes it and answers with the stored
  // file, which is what the block shows (not the file the person picked).
  async function upload(file: File) {
    const saved = await unwrap(
      api.PUT('/organisations/{id}/logo', {
        params: { path: { id: organisation.id } },
        body: file as unknown as string,
        bodySerializer: (body: unknown) => body as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    return saved.logoUrl;
  }

  async function remove() {
    await unwrap(
      api.DELETE('/organisations/{id}/logo', { params: { path: { id: organisation.id } } }),
    );
  }
</script>

<ImageBlock
  imageUrl={organisation.logoUrl}
  {editable}
  maxBytes={MAX_LOGO_BYTES}
  {texts}
  {upload}
  {remove}
  {onchanged}
/>
