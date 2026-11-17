<script lang="ts">
  import { getShell } from '@scorpion/ui-kit';
  import type { Branding } from '@scorpion/contracts/client';
  import { SOFTWARE } from '../software.ts';

  let { branding }: { branding: Branding } = $props();
  const { t, href } = getShell();
  const year = new Date().getFullYear();
</script>

<footer class="bg-base-200 border-base-300 border-t px-4 py-4 text-sm">
  <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
    <div class="flex flex-col gap-1">
      <p>{t('app.footer.copyright', { year, name: branding.instanceName })}</p>
      <!-- The software's own attribution: fixed, no setting (ADR-0050). -->
      <p data-testid="software-attribution" class="text-base-content/70">
        {t('app.footer.poweredBy')}
        <a class="link" href={SOFTWARE.url} rel="noopener noreferrer">{SOFTWARE.name}</a>
        {SOFTWARE.version} ·
        <a class="link" href={SOFTWARE.licenceUrl} rel="noopener noreferrer"
          >{t('app.footer.licence', { licence: SOFTWARE.licence })}</a
        >
      </p>
    </div>
    <nav aria-label={t('app.footer.legal')}>
      <ul class="flex flex-wrap gap-4">
        {#each branding.legalPages as legal (legal)}
          <li><a class="link" href={href(`/legal/${legal}`)}>{t(`legal.${legal}`)}</a></li>
        {/each}
        {#if branding.imprintUrl}
          <li>
            <a class="link" href={branding.imprintUrl} rel="noopener noreferrer"
              >{t('legal.imprintExternal')}</a
            >
          </li>
        {/if}
        {#if branding.contactEmail}
          <li>
            <a class="link" href={`mailto:${branding.contactEmail}`}>{t('app.footer.contact')}</a>
          </li>
        {/if}
      </ul>
    </nav>
  </div>
</footer>
