<script lang="ts">
  // Administration, the settings of one module: a form drawn from the module's own schema. A save sends the
  // values that differ from the defaults, with the version that was read; if somebody saved in between, nothing is written and the
  // person is asked to load the current values. The server judges the values, and its messages show on
  // the fields they name.
  import {
    Breadcrumb,
    failureMessage,
    describeRoot,
    failureOf,
    getShell,
    omitDefaults,
    SchemaForm,
    type FormFailure,
    type JsonSchema,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { SettingsFormData } from './loaders.ts';
  import LogoWidget from './LogoWidget.svelte';
  import { omit, overlay } from './object.ts';

  let { data }: { data: SettingsFormData } = $props();
  const { t, href, api, refresh, toaster, withReauth } = getShell();

  // core.settings keeps its branding on its own screen; the rest of its form is the rate limits.
  const own = $derived(data.module === 'core.settings');
  const schema = $derived.by((): JsonSchema => {
    if (!own) return data.schema;
    return {
      ...data.schema,
      properties: omit((data.schema.properties ?? {}) as Record<string, unknown>, 'branding'),
    };
  });
  const shown = $derived(own ? omit(data.values, 'branding') : data.values);

  let failure = $state<FormFailure>();
  let general = $state<string>();
  let conflict = $state(false);
  let busy = $state(false);

  async function save(values: unknown) {
    busy = true;
    failure = undefined;
    general = undefined;
    try {
      // What the form does not draw (the branding of core.settings) goes back as it was.
      const merged = own
        ? overlay(data.values, values as Record<string, unknown>)
        : (values as Record<string, unknown>);
      // Only what differs from the default is stored, so a later change of a default reaches this instance.
      const stored = omitDefaults(merged, describeRoot(data.schema)) as Record<string, unknown>;
      await withReauth(() =>
        unwrap(
          api.PUT('/settings/{module}', {
            params: { path: { module: data.module } },
            body: { version: data.version, values: stored },
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

  const nameOf = (module: string) => {
    const key = `admin.settings.module.${module}`;
    const text = t(key);
    return text === key ? module : text;
  };
</script>

<svelte:head><title>{nameOf(data.module)} · {t('admin.settings.title')}</title></svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <Breadcrumb
    items={[
      { label: t('nav.section.admin') },
      { label: t('admin.settings.title'), href: href('/admin/settings') },
      { label: nameOf(data.module) },
    ]}
  />
  <h1 class="text-2xl font-bold">{nameOf(data.module)}</h1>
  <p class="opacity-80">
    <code>{data.module}</code> · {t('admin.settings.version', { version: data.version })}
  </p>
  {#if own}
    <p>
      {t('admin.settings.brandingElsewhere')}
      <a class="link" href={href('/admin/settings/branding')}>{t('admin.settings.area.branding')}</a
      >
    </p>
  {/if}
  {#if general}<p role="alert" class="text-error">{general}</p>{/if}

  <SchemaForm
    {schema}
    value={shown}
    {failure}
    errorPrefix="values"
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
