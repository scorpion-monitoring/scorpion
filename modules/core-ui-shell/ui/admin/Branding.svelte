<script lang="ts">
  // Administration, branding: what the instance calls itself, its logos (light and dark theme), the contact
  // address and the legal texts. It is the branding part of the settings of core.settings, drawn from its
  // schema, with a control for the logos that uploads the file. The rest of those settings is kept as it was.
  import {
    Breadcrumb,
    failureMessage,
    failureOf,
    getShell,
    SchemaForm,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import LogoWidget from './LogoWidget.svelte';
  import type { SettingsFormData } from './loaders.ts';

  let { data }: { data: SettingsFormData } = $props();
  const { t, href, api, refresh, toaster, withReauth } = getShell();

  const shown = $derived((data.values.branding ?? {}) as Record<string, unknown>);
  let failure = $state<FormFailure>();
  let general = $state<string>();
  let conflict = $state(false);
  let busy = $state(false);

  async function save(values: unknown) {
    busy = true;
    failure = undefined;
    general = undefined;
    try {
      await withReauth(() =>
        unwrap(
          api.PUT('/settings/{module}', {
            params: { path: { module: 'core.settings' } },
            body: { version: data.version, values: { ...data.values, branding: values } },
          }),
        ),
      );
      toaster.success(t('admin.settings.saved'));
      conflict = false;
      await refresh();
    } catch (error) {
      const next = failureOf(error);
      if (next.status === 409) conflict = true;
      else if (next.status === 422) failure = next;
      else general = failureMessage(next, t);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>{t('admin.settings.area.branding')} · {t('admin.settings.title')}</title></svelte:head
>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('admin.settings.title'), href: href('/admin/settings') },
      { label: t('admin.settings.area.branding') },
    ]}
  />
  <h1 class="text-2xl font-bold">{t('admin.settings.area.branding')}</h1>
  <p>{t('admin.branding.lead')}</p>
  {#if general}<p role="alert" class="text-error">{general}</p>{/if}

  <SchemaForm
    schema={data.schema}
    value={shown}
    {failure}
    errorPrefix="values.branding"
    {busy}
    {conflict}
    widgets={{ logo: LogoWidget }}
    onreload={() => {
      conflict = false;
      failure = undefined;
      void refresh();
    }}
    onsubmit={save}
  />
</div>
