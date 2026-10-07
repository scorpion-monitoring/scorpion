<script lang="ts">
  // Administration, settings: the way into every settings screen. One card per module that has settings
  // (their forms are drawn from the module's own schema), and the three screens that are not a plain form:
  // branding (names, logos, legal texts), secrets and vocabularies.
  import { Breadcrumb, getShell, Time } from '@scorpion/ui-kit';
  import type { SettingsIndexData } from './loaders.ts';

  let { data }: { data: SettingsIndexData } = $props();
  const { t, href } = getShell();

  /** The name of a module in words when the catalogue has one, else its id. */
  const nameOf = (module: string) => {
    const key = `admin.settings.module.${module}`;
    const text = t(key);
    return text === key ? module : text;
  };
</script>

<svelte:head><title>{t('admin.settings.title')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb items={[{ label: t('nav.section.admin') }, { label: t('admin.settings.title') }]} />
  <h1 class="text-2xl font-bold">{t('admin.settings.title')}</h1>
  <p>{t('admin.settings.lead')}</p>

  <section aria-labelledby="areas-title" class="flex flex-col gap-3">
    <h2 id="areas-title" class="text-xl font-semibold">{t('admin.settings.areas')}</h2>
    <ul class="grid gap-3 sm:grid-cols-3">
      {#each [{ path: '/admin/settings/branding', name: 'branding' }, { path: '/admin/settings/secrets', name: 'secrets' }, { path: '/admin/settings/vocabularies', name: 'vocabularies' }] as area (area.name)}
        <li class="card bg-base-100 border-base-300 border">
          <div class="card-body gap-1">
            <h3 class="card-title text-base">
              <a class="link link-hover" href={href(area.path)}
                >{t(`admin.settings.area.${area.name}`)}</a
              >
            </h3>
            <p class="text-sm">{t(`admin.settings.area.${area.name}.lead`)}</p>
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <section aria-labelledby="modules-title" class="flex flex-col gap-3">
    <h2 id="modules-title" class="text-xl font-semibold">{t('admin.settings.modules')}</h2>
    <ul class="grid gap-3 sm:grid-cols-2">
      {#each data.modules as row (row.module)}
        <li class="card bg-base-100 border-base-300 border">
          <div class="card-body gap-1">
            <h3 class="card-title text-base">
              <a class="link link-hover" href={href(`/admin/settings/${row.module}`)}
                >{nameOf(row.module)}</a
              >
            </h3>
            <p class="text-sm opacity-80">
              <code>{row.module}</code>
              ·
              {#if row.updatedAt}
                {t('admin.settings.changedAt')} <Time iso={row.updatedAt} />
              {:else}
                {t('admin.settings.defaults')}
              {/if}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  </section>
</div>
