<script lang="ts">
  import { page } from '$app/state';
  import { url } from '@scorpion/contracts';
  import { shellMessages } from '#lib/messages.ts';
  import { createTranslator } from '@scorpion/ui-kit';

  // The error page can be shown when the layout itself failed, so it holds no context and reads its
  // own few texts. The path of "go home" is the page's own origin plus the base the browser is under.
  const t = createTranslator(shellMessages, 'en');
  const status = $derived(page.status);
  const text = $derived(
    status === 403 || status === 404
      ? t(`app.error.${status}`)
      : (page.error?.message ?? t('app.error.title')),
  );
  // The base path is the part of the URL before the application's own path; the server put it in the
  // layout data when it could, else the root is the best guess.
  const base = $derived((page.data as { basePath?: string }).basePath ?? '/');
</script>

<svelte:head>
  <title>{status} · {t('app.error.title')}</title>
</svelte:head>

<section class="hero py-16" aria-labelledby="error-title">
  <div class="hero-content flex-col text-center">
    <p class="text-6xl font-bold" aria-hidden="true">{status}</p>
    <h1 id="error-title" class="text-2xl font-semibold">{text}</h1>
    {#if page.error?.requestId}
      <p class="text-sm opacity-70">{t('app.error.requestId', { id: page.error.requestId })}</p>
    {/if}
    <a class="btn btn-primary" href={url(base, '/')}>{t('app.error.home')}</a>
  </div>
</section>
