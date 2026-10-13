<script lang="ts">
  // The create wizard. It draws itself from `GET /services/schema` and holds no field, step, limit or type of
  // its own: the steps and fields, the widget of each (one table, `widgets.ts`), the JSON Schema of a step, the
  // limits and the defaults all come from the server. The form is ONE nested object addressed by the fields'
  // JSON pointers; the fields and the JSON console edit that same object. The browser checks a step with the
  // step's JSON Schema before it lets the person go on; the server judges the whole object once, with one
  // `POST /services`, and its answer is shown on the fields. Nothing the person typed is lost by a failure:
  // the form state lives here, not in the steps. The icon is uploaded after the service exists.
  import { unwrap } from '@scorpion/contracts/client';
  import type { SchemaIssue } from '@scorpion/ui-kit/json-schema';
  import {
    Alert,
    Breadcrumb,
    ImageBlock,
    SchemaField,
    Wizard,
    describeField,
    failureOf,
    getShell,
    sameJson,
    type FieldNode,
    type JsonSchema,
    type WizardStep as KitStep,
  } from '@scorpion/ui-kit';
  import { tick, untrack } from 'svelte';
  import { errorMap } from './check-messages.ts';
  import DevConsole from './DevConsole.svelte';
  import {
    checkStep,
    failureView,
    firstStepWithError,
    getAt,
    noErrors,
    rememberErrors,
    setAt,
    shownErrors,
    startForm,
    toBody,
    unknownPointers,
    visibleSteps,
    withoutStep,
  } from './form-state.ts';
  import { MAX_ICON_BYTES, MAX_ICON_MIB } from './limits.ts';
  import { isOffered } from './offered.ts';
  import { setWizardContext } from './wizard-context.ts';
  import { stepConditions } from './wizard-extensions.ts';
  import type { WizardData, WizardField, WizardStep } from './wizard-types.ts';
  import { componentWidgets, widgetEntry } from './widgets.ts';

  let { data }: { data: WizardData } = $props();
  const { t, api, href, toaster } = getShell();

  // svelte-ignore state_referenced_locally
  const schema = data.schema;
  const allFields = schema.steps.flatMap((step) => step.fields);

  setWizardContext({
    field: (pointer) => allFields.find((field) => field.path === pointer),
    organisations: (role) => data.organisations[role] ?? { options: [], truncated: false },
  });

  // ----- the form: one nested object ---------------------------------------------------------------

  let form = $state<Record<string, unknown>>(startForm(schema));
  const body = $derived(toBody($state.snapshot(form), schema));
  const initialBody = toBody(startForm(schema), schema);
  const dirty = $derived(!sameJson(body, initialBody));
  const steps = $derived(visibleSteps(schema.steps, $state.snapshot(form), stepConditions()));
  const kitSteps = $derived<KitStep[]>(
    steps.map((step) => ({ id: step.id, label: t(step.title) })),
  );

  // ----- errors: shown on the field they name, until that field changes -----------------------------

  let found = $state(noErrors());
  const errors = $derived(shownErrors(found, body));
  let general = $state<string[]>([]);

  /** What the browser's schemas say about the steps shown (all of them: the server judges the whole object once). */
  function judge(current: Record<string, unknown>, among: readonly WizardStep[]) {
    const issues: SchemaIssue[] = among.flatMap((step) => checkStep(step, current));
    const unknown = unknownPointers(current, schema).map((pointer): SchemaIssue => ({
      pointer,
      keyword: 'additionalProperties',
    }));
    return { issues, unknown };
  }

  const stepById = (id: string) => schema.steps.find((step) => step.id === id)!;

  /** Replaces the messages of one step with what its check found; the other steps' messages stay. */
  function showStep(step: WizardStep, messages: ReadonlyMap<string, readonly string[]>) {
    found = new Map([...withoutStep(found, step), ...rememberErrors(messages, body)]);
  }

  // ----- the steps -----------------------------------------------------------------------------------

  let wizard = $state<{ reopen: (stepId: string) => void }>();

  function validate(stepId: string): string[] {
    const step = stepById(stepId);
    // A field whose widget nobody registered cannot be filled in: say so, never skip it quietly.
    const stuck = step.fields.find((field) => widgetEntry(field.widget) === undefined);
    if (stuck)
      return [t('services.wizard.noWidget', { widget: stuck.widget, field: t(stuck.label) })];
    const issues = checkStep(step, body);
    showStep(step, errorMap(issues, schema.steps, t));
    return issues.length > 0 ? [t('services.wizard.fixFields')] : [];
  }

  // ----- the request ---------------------------------------------------------------------------------

  let busy = $state(false);
  let created = $state<{ id: string; slug: string; name: string; iconUrl?: string | undefined }>();
  let doneHeading = $state<HTMLElement>();

  function show(failure: ReturnType<typeof failureOf>, sent: Record<string, unknown>) {
    const view = failureView(failure, schema, t);
    found = rememberErrors(view.messages, sent);
    general = view.loose;
    // Where the person goes: the first step with a message, else the last step (to try again).
    const target =
      firstStepWithError(
        steps,
        view.messages.map(([pointer]) => pointer),
      ) ?? steps[steps.length - 1]?.id;
    if (target !== undefined) wizard?.reopen(target);
  }

  async function create() {
    const sent = $state.snapshot(body);
    general = [];
    // The browser judges every step once more (a console edit or a step skipped by the progress list).
    const { issues, unknown } = judge(sent, steps);
    if (issues.length > 0 || unknown.length > 0) {
      const messages = errorMap([...issues, ...unknown], schema.steps, t);
      found = rememberErrors(messages, sent);
      wizard?.reopen(firstStepWithError(steps, messages.keys()) ?? steps[0]!.id);
      return;
    }
    busy = true;
    try {
      // The body is the form's nested object, which the loose create body accepts; its fields are the config's.
      const saved = await unwrap(api.POST('/services', { body: sent as never }));
      created = { id: saved.id, slug: saved.slug, name: saved.name, iconUrl: saved.iconUrl };
      found = noErrors();
      toaster.success(t('services.done.toast', { name: saved.name }));
      await tick();
      doneHeading?.focus();
    } catch (error) {
      // A network failure reads as status 0: a message on the form and nothing lost.
      show(failureOf(error), sent);
    } finally {
      busy = false;
    }
  }

  // ----- the fields ----------------------------------------------------------------------------------

  /** The JSON Schema of one field, found at its pointer in the step's schema. */
  function propertyOf(step: WizardStep, field: WizardField): JsonSchema {
    let node: unknown = step.schema;
    for (const segment of field.path.slice(1).split('/')) {
      const properties = (node as { properties?: Record<string, unknown> }).properties;
      node = properties?.[segment];
    }
    return (node ?? { type: 'string' }) as JsonSchema;
  }

  /**
   * The form draws a string as a box of several lines when its limit is long. Only the `description` format is
   * written in paragraphs; a web address or a name is one line whatever its limit, so the limit is left to the
   * check (the step's schema) and not to the control.
   */
  function oneLine(schema: JsonSchema, field: WizardField): JsonSchema {
    const long = typeof schema.maxLength === 'number' && schema.maxLength > 300;
    if (!long || field.config.format === 'description') return schema;
    return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'maxLength'));
  }

  function nodeOf(step: WizardStep, field: WizardField): FieldNode {
    const property = oneLine(propertyOf(step, field), field);
    const items = property.items;
    const decorated: JsonSchema = {
      ...property,
      ...(typeof items === 'object' &&
        items !== null && {
          items: oneLine(items as JsonSchema, field),
        }),
      title: t(field.label),
      ...(field.help !== undefined && { description: t(field.help) }),
      widget: field.widget,
    };
    return describeField(decorated, decorated, {
      pointer: field.path,
      key: field.path.slice(field.path.lastIndexOf('/') + 1),
      required: field.required,
    });
  }

  const widgets = $derived(componentWidgets(allFields.map((field) => field.widget)));

  // ----- the JSON console (outside production only) ---------------------------------------------------

  let consoleText = $state(JSON.stringify(initialBody, null, 2));
  let consoleProblems = $state<string[]>([]);
  // The text a console edit produced, so the sync from the form does not rewrite what the person is typing.
  let lastConsole: string | undefined;

  $effect(() => {
    const next = JSON.stringify(body, null, 2);
    untrack(() => {
      if (next === lastConsole) return;
      lastConsole = undefined;
      consoleText = next;
      consoleProblems = [];
    });
  });

  function editConsole(text: string) {
    consoleText = text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      consoleProblems = [t('services.console.invalid')];
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      consoleProblems = [t('services.console.notObject')];
      return;
    }
    // The same object the fields edit; then the same checks a field edit gets, on every step.
    form = parsed as Record<string, unknown>;
    const mapped = toBody(parsed as Record<string, unknown>, schema);
    lastConsole = JSON.stringify(mapped, null, 2);
    const { issues, unknown } = judge(mapped, steps);
    const messages = errorMap([...issues, ...unknown], schema.steps, t);
    found = rememberErrors(messages, mapped);
    consoleProblems = [
      ...unknown.map((issue) => `${issue.pointer}: ${t('services.check.unknown')}`),
      ...issues.flatMap((issue) =>
        (messages.get(issue.pointer) ?? []).map((message) => `${issue.pointer}: ${message}`),
      ),
    ].filter((line, index, all) => all.indexOf(line) === index);
  }

  // ----- the screen after the creation ----------------------------------------------------------------

  const iconTexts = $derived({
    title: t('services.icon.title'),
    alt: t('services.icon.alt', { name: created?.name ?? '' }),
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

  // The image is the request body as it is; the server checks it, re-encodes it and answers with the stored file.
  async function upload(file: File) {
    const saved = await unwrap(
      api.PUT('/services/{id}/icon', {
        params: { path: { id: created!.id } },
        body: file as unknown as string,
        bodySerializer: (sent: unknown) => sent as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    return saved.iconUrl;
  }
  async function removeIcon() {
    await unwrap(api.DELETE('/services/{id}/icon', { params: { path: { id: created!.id } } }));
  }

  const detailOffered = isOffered('/services/:slug');
</script>

<svelte:head><title>{t('services.new')}</title></svelte:head>

<div class="flex flex-col gap-6">
  <Breadcrumb
    items={[{ label: t('services.title'), href: href('/services') }, { label: t('services.new') }]}
  />
  <h1 class="text-2xl font-bold">{t('services.new')}</h1>
  {#if !created}<p class="opacity-70">{t('services.new.intro')}</p>{/if}

  {#if created}
    <section class="flex flex-col gap-4" aria-labelledby="services-done">
      <h2 id="services-done" class="text-xl font-semibold" tabindex="-1" bind:this={doneHeading}>
        {t('services.done.title')}
      </h2>
      <p>{t('services.done.body', { name: created.name })}</p>
      <ImageBlock
        imageUrl={created.iconUrl}
        editable
        maxBytes={MAX_ICON_BYTES}
        texts={iconTexts}
        {upload}
        remove={removeIcon}
      />
      <p class="flex flex-wrap gap-4">
        {#if detailOffered}
          <a class="btn btn-primary" href={href(`/services/${created.slug}`)}
            >{t('services.done.open', { name: created.name })}</a
          >
        {/if}
        <a class="btn" class:btn-primary={!detailOffered} href={href('/services')}
          >{t('services.done.catalogue')}</a
        >
      </p>
    </section>
  {:else}
    <div class="grid gap-6" class:lg:grid-cols-2={schema.devConsole}>
      <div class="flex flex-col gap-4">
        {#if general.length > 0}
          <Alert kind="error">
            <ul class="list-disc ps-4">
              {#each general as line (line)}<li>{line}</li>{/each}
            </ul>
          </Alert>
        {/if}
        <Wizard
          bind:this={wizard}
          steps={kitSteps}
          {step}
          {validate}
          onfinish={create}
          {dirty}
          {busy}
          finishLabel={t('services.wizard.create')}
        />
      </div>
      {#if schema.devConsole}
        <DevConsole text={consoleText} problems={consoleProblems} onedit={editConsole} />
      {/if}
    </div>
  {/if}
</div>

{#snippet step(stepId: string)}
  {@const current = stepById(stepId)}
  <div class="flex flex-col gap-4">
    {#each current.intro as key (key)}
      <p>{t(key)}</p>
    {/each}
    {#each current.fields as field (field.key)}
      {#if widgetEntry(field.widget) === undefined}
        <Alert kind="error">
          {t('services.wizard.noWidget', { widget: field.widget, field: t(field.label) })}
        </Alert>
      {:else}
        <SchemaField
          node={nodeOf(current, field)}
          bind:value={() => getAt(form, field.path), (next) => setAt(form, field.path, next)}
          {errors}
          {widgets}
          disabled={busy}
        />
      {/if}
    {/each}
  </div>
{/snippet}
