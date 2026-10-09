<script lang="ts">
  // A form drawn from a JSON Schema (the output of `z.toJSONSchema`): the settings of a module, a request
  // body. It draws the fields, keeps the draft, sends only what was filled in, and puts the server's
  // messages on the fields they name. It repeats no rule of the schema in the client: the server judges.
  // The convention for labels, hints, groups and widgets is in the README of this package.
  import type { Component, Snippet } from 'svelte';
  import Alert from './Alert.svelte';
  import { getShell } from './context.ts';
  import { type FormFailure } from './forms.ts';
  import type { WidgetProps } from './kit-types.ts';
  import SchemaField from './SchemaField.svelte';
  import SubmitButton from './SubmitButton.svelte';
  import {
    describeRoot,
    emptyValue,
    errorsByPointer,
    labelOfPointer,
    prune,
    type JsonSchema,
  } from './schema-form.ts';

  let {
    schema,
    value,
    failure,
    errorPrefix,
    busy = false,
    disabled = false,
    submitLabel,
    onsubmit,
    widgets,
    conflict = false,
    onreload,
    children,
  }: {
    schema: JsonSchema;
    /** The values to start from. A new object replaces the draft (after a save, or a reload). */
    value: unknown;
    /** What the server said about the last attempt (`failureOf(error)`). */
    failure?: FormFailure;
    /** What the API puts in front of a field path (`values` for the body of a settings save). */
    errorPrefix?: string;
    busy?: boolean;
    disabled?: boolean;
    submitLabel?: string;
    /** Gets the values to send: what was filled in, and nothing of a secret nobody typed. */
    onsubmit: (values: unknown) => void | Promise<void>;
    /** Custom widgets by the name the schema asks for (`widget`). */
    widgets?: Readonly<Record<string, Component<WidgetProps>>>;
    /** The stored version changed since the form was opened (409): offer to load it again. */
    conflict?: boolean;
    onreload?: () => void;
    /** More to show above the submit button. */
    children?: Snippet;
  } = $props();
  const { t } = getShell();

  const root = $derived(describeRoot(schema));
  const errors = $derived(errorsByPointer(failure?.fields ?? {}, errorPrefix));
  const summary = $derived(
    [...errors].flatMap(([pointer, messages]) =>
      messages.map((message) => ({
        label: labelOfPointer(root, pointer, (n) => t('kit.form.item', { index: n })),
        message,
      })),
    ),
  );

  // The draft is a copy of `value`; a new `value` starts a new draft.
  let draft = $state<unknown>();
  let source: unknown;
  $effect.pre(() => {
    if (source !== value) {
      source = value;
      draft = structuredClone($state.snapshot(value) ?? emptyValue(root));
    }
  });

  let summaryElement = $state<HTMLElement>();
  $effect(() => {
    // After a failed save the person is taken to the list of what to fix.
    if (summary.length > 0 || (failure?.general.length ?? 0) > 0) summaryElement?.focus();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    await onsubmit(prune($state.snapshot(draft), root));
  }
</script>

<form method="post" onsubmit={submit} class="flex flex-col gap-6" novalidate>
  {#if conflict}
    <Alert kind="warning">
      <span>{t('kit.form.conflict')}</span>
      {#if onreload}
        <button type="button" class="btn btn-sm ms-3" onclick={onreload}
          >{t('kit.form.reload')}</button
        >
      {/if}
    </Alert>
  {/if}
  {#if summary.length > 0 || (failure?.general.length ?? 0) > 0}
    <div
      bind:this={summaryElement}
      tabindex="-1"
      role="alert"
      class="alert alert-error flex-col items-start"
    >
      <p class="font-medium">{t('kit.form.errors')}</p>
      <ul class="list-disc ps-5">
        {#each failure?.general ?? [] as message (message)}<li>{message}</li>{/each}
        {#each summary as item, index (index)}<li>{item.label}: {item.message}</li>{/each}
      </ul>
    </div>
  {/if}
  {#if draft !== undefined}
    <SchemaField node={root} bind:value={draft} {errors} {widgets} {disabled} root />
  {/if}
  {#if children}{@render children()}{/if}
  <div><SubmitButton {busy}>{submitLabel ?? t('kit.form.save')}</SubmitButton></div>
</form>
