<script lang="ts">
  // The edit form of the service page. It draws itself from what the API said: the fields of
  // `GET /services/schema` that the record's `editableFields` allows (the same widgets and the same
  // pure helpers as the wizard), the fields the caller may not change as plain text with the reason, and the
  // icon block. It holds no field, limit or right of its own and decides nothing from a role. A save sends only
  // what changed (`patchBody`); the server judges it, and its refusal is shown here in words: a 403 for the
  // whole form (the page may be out of date), a 409 for the short name on its field, a 422 on the fields it
  // names. Nothing the person typed is lost by a failure.
  import { unwrap } from '@scorpion/contracts/client';
  import { Alert, ImageBlock, SchemaField, failureOf, getShell } from '@scorpion/ui-kit';
  import { errorMap } from './check-messages.ts';
  import {
    editFields,
    editIssues,
    formFromService,
    hasChanges,
    patchBody,
    readOnlyFields,
  } from './edit-state.ts';
  import { fieldNode } from './field-node.ts';
  import {
    failureView,
    getAt,
    noErrors,
    rememberErrors,
    setAt,
    shownErrors,
    toBodyOf,
  } from './form-state.ts';
  import { iconTexts, removeIcon, uploadIcon } from './icon.ts';
  import { MAX_ICON_BYTES } from './limits.ts';
  import type { ServiceData } from './loaders.ts';
  import { setWizardContext } from './wizard-context.ts';
  import type { WizardField, WizardStep } from './wizard-types.ts';
  import { componentWidgets, widgetEntry } from './widgets.ts';

  /** What the server answers a change with: the service as `GET /services/{id}` gives it. */
  type Saved = ServiceData['service'];

  let {
    data,
    onsaved,
    oncancel,
    onicon,
  }: {
    data: ServiceData;
    /** Called with the record the server answered with. */
    onsaved: (saved: Saved) => void;
    oncancel: () => void;
    /** The icon changed: the page shows the new one. */
    onicon: () => void;
  } = $props();
  const { t, api, guardLeave, locale } = getShell();

  // The record the form started from: a later reload of the page does not rewrite what is being typed.
  // svelte-ignore state_referenced_locally
  const service = data.service;
  // svelte-ignore state_referenced_locally
  const schema = data.schema;
  const allFields: WizardField[] = schema.steps.flatMap((step) => step.fields);
  const drawn = editFields(allFields, service.editableFields);
  const fixed = readOnlyFields(allFields, service.editableFields);
  const stepOf = (field: WizardField): WizardStep =>
    schema.steps.find((step) => step.fields.includes(field))!;

  setWizardContext({
    field: (pointer) => allFields.find((field) => field.path === pointer),
    organisations: (role) => data.organisations[role] ?? { options: [], truncated: false },
  });

  const initial = formFromService(service, allFields);
  let form = $state<Record<string, unknown>>(formFromService(service, allFields));
  const current = $derived(toBodyOf($state.snapshot(form), drawn));
  const patch = $derived(patchBody(initial, $state.snapshot(form), drawn));
  const dirty = $derived(hasChanges(patch));
  $effect(() => guardLeave(() => dirty));

  let found = $state(noErrors());
  const errors = $derived(shownErrors(found, current));
  let general = $state<string[]>([]);
  let busy = $state(false);
  // The Edit button has gone: the keyboard continues at the form, where the person is working now.
  let heading = $state<HTMLElement>();
  $effect(() => heading?.focus());

  async function save() {
    general = [];
    const issues = editIssues(schema.steps, $state.snapshot(form), drawn);
    if (issues.length > 0) {
      found = rememberErrors(errorMap(issues, schema.steps, t), current);
      general = [t('services.edit.fixFields')];
      return;
    }
    const sent = $state.snapshot(current);
    busy = true;
    try {
      // The patch is a part of the form's nested object, which the loose patch body accepts.
      const saved = await unwrap(
        api.PATCH('/services/{id}', { params: { path: { id: service.id } }, body: patch as never }),
      );
      found = noErrors();
      onsaved(saved);
    } catch (error) {
      const view = failureView(failureOf(error), schema, t, 'services.edit.forbidden');
      found = rememberErrors(view.messages, sent);
      general = view.loose;
    } finally {
      busy = false;
    }
  }

  /** Written in the person's language: the name of the owning role, inside the sentence of the identity line. */
  const owner = $derived.by(() => {
    const label = schema.roles.find((role) => role.memberOnly)?.label ?? '';
    return locale().startsWith('en') ? label.toLowerCase() : label;
  });

  const widgets = $derived(componentWidgets(drawn.map((field) => field.widget)));
  const texts = $derived(iconTexts(t, service.name));
  const upload = (file: File) => uploadIcon(api, service.id, file);
  const dropIcon = () => removeIcon(api, service.id);
  const mayChangeIcon = service.editableFields.includes('icon');

  /** What a fixed field holds, as text: organisations by name, a list joined. */
  function fixedText(field: WizardField): string {
    if (field.role !== undefined) {
      return service.organisations
        .filter((organisation) => organisation.role === field.role)
        .map((organisation) => organisation.name)
        .join(', ');
    }
    const value = getAt(initial, field.path);
    return Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
  }
</script>

<section class="flex flex-col gap-6" aria-labelledby="service-edit-title">
  <h2 id="service-edit-title" class="text-xl font-semibold" tabindex="-1" bind:this={heading}>
    {t('services.edit.title', { name: service.name })}
  </h2>

  {#if mayChangeIcon}
    <ImageBlock
      imageUrl={service.iconUrl}
      editable
      maxBytes={MAX_ICON_BYTES}
      {texts}
      {upload}
      remove={dropIcon}
      onchanged={onicon}
    />
  {/if}

  <form
    class="flex flex-col gap-4"
    novalidate
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    {#if general.length > 0}
      <Alert kind="error">
        <ul class="list-disc ps-4">
          {#each general as line (line)}<li>{line}</li>{/each}
        </ul>
      </Alert>
    {/if}

    {#if fixed.length > 0}
      <section class="flex flex-col gap-2" aria-labelledby="service-fixed-title">
        <h3 id="service-fixed-title" class="font-medium">{t('services.edit.fixed')}</h3>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
          {#each fixed as field (field.key)}
            <dt class="text-sm opacity-70">{t(field.label)}</dt>
            <dd>{fixedText(field)}</dd>
          {/each}
        </dl>
        <p class="text-sm opacity-70" id="service-fixed-reason">
          {t('services.edit.identity', { owner })}
        </p>
      </section>
    {/if}

    {#each drawn as field (field.key)}
      {#if widgetEntry(field.widget) === undefined}
        <Alert kind="error">
          {t('services.edit.noWidget', { widget: field.widget, field: t(field.label) })}
        </Alert>
      {:else}
        <SchemaField
          node={fieldNode(stepOf(field), field, t)}
          bind:value={() => getAt(form, field.path), (next) => setAt(form, field.path, next)}
          {errors}
          {widgets}
          disabled={busy}
        />
      {/if}
    {/each}

    <div class="flex flex-wrap items-center gap-2">
      {#if dirty}
        <button type="submit" class="btn btn-primary" disabled={busy} aria-busy={busy}>
          {t('services.edit.save')}
        </button>
      {/if}
      <button type="button" class="btn" disabled={busy} onclick={oncancel}>
        {t('services.edit.cancel')}
      </button>
      {#if !dirty}<span class="text-sm opacity-70">{t('services.edit.nothing')}</span>{/if}
    </div>
  </form>
</section>
