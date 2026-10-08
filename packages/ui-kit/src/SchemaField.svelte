<script lang="ts">
  // One field of a `SchemaForm`, and, for an object, an array or a choice, the fields inside it (the
  // component draws itself). What it draws comes from `describeField`; what is typed goes into `value`.
  import { tick, type Component } from 'svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import { getShell } from './context.ts';
  import FieldShell from './FieldShell.svelte';
  import type { WidgetProps } from './kit-types.ts';
  import SchemaField from './SchemaField.svelte';
  import {
    childPointer,
    describeField,
    emptyValue,
    groupChildren,
    hasErrorsUnder,
    messagesFor,
    stepOf,
    variantIndex,
    variantLabel,
    variantSeed,
    type FieldNode,
  } from './schema-form.ts';

  let {
    node,
    value = $bindable(),
    errors,
    widgets = {},
    disabled = false,
    root = false,
  }: {
    node: FieldNode;
    value: unknown;
    errors: ReadonlyMap<string, readonly string[]>;
    widgets?: Readonly<Record<string, Component<WidgetProps>>>;
    disabled?: boolean;
    /** The outermost object: drawn without a frame of its own. */
    root?: boolean;
  } = $props();
  const { t } = getShell();

  const own = $derived(
    messagesFor(errors, node.pointer, node.kind === 'scalarArray' || node.kind === 'opaque'),
  );
  const required = $derived(node.required);
  const idBase = $props.id();
  const Widget = $derived(node.widget ? widgets[node.widget] : undefined);

  const record = $derived((value ?? {}) as Record<string, unknown>);

  // --- arrays ---------------------------------------------------------------------------------------
  let announcement = $state('');
  const list = $derived(Array.isArray(value) ? (value as unknown[]) : []);
  const canAdd = $derived(node.maxItems === undefined || list.length < node.maxItems);
  const itemNode = (index: number) =>
    describeField(node.items ?? {}, node.root, {
      pointer: childPointer(node.pointer, index),
      key: String(index),
      required: true,
    });

  const firstControl = (index: number) =>
    document
      .getElementById(`${idBase}-item-${index}`)
      ?.querySelector<HTMLElement>('input, select, textarea');

  async function add() {
    const index = list.length;
    value = [...list, emptyValue(itemNode(index))];
    announcement = t('kit.form.itemAdded', { label: node.label, index: index + 1 });
    await tick();
    firstControl(index)?.focus();
  }
  // Removing an item asks first (an item can hold a lot that is typed again slowly); a text item nothing was
  // typed in is removed at once. The dialog traps focus and Escape cancels; the form is not saved by it.
  let removing = $state<number>();
  function askToRemove(index: number) {
    if (node.kind === 'scalarArray' && (list[index] === '' || list[index] === undefined)) {
      void remove(index);
    } else {
      removing = index;
    }
  }
  async function confirmRemove() {
    const index = removing;
    removing = undefined;
    if (index === undefined) return;
    // Let the dialog close and give focus back first; `remove` then moves it to the item that took the place.
    // The dialog gives focus back to the button that opened it once it has closed; the focus that follows
    // the removal must come after that.
    await remove(index, true);
  }
  async function remove(index: number, afterDialog = false) {
    const remaining = list.length - 1;
    value = list.filter((_, position) => position !== index);
    announcement = t('kit.form.itemRemoved', { label: node.label, index: index + 1 });
    await tick();
    if (afterDialog) await new Promise((resolve) => setTimeout(resolve, 50));
    // Focus goes to the item that took its place, or the one before it, or the Add button when none is left.
    (remaining > 0
      ? firstControl(Math.min(index, remaining - 1))
      : document.getElementById(`${idBase}-add`)
    )?.focus();
  }
  async function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target]!, next[index]!];
    value = next;
    announcement = t('kit.form.itemMoved', {
      label: node.label,
      index: index + 1,
      position: target + 1,
    });
    await tick();
    // Focus follows the item: on the button that moved it, or on the other one when the item has reached an end.
    const same = document.getElementById(`${idBase}-${by < 0 ? 'up' : 'down'}-${target}`);
    const other = document.getElementById(`${idBase}-${by < 0 ? 'down' : 'up'}-${target}`);
    ((same as HTMLButtonElement | null)?.disabled ? other : same)?.focus();
  }

  // --- a choice between shapes ----------------------------------------------------------------------
  const chosen = $derived(node.kind === 'oneOf' ? variantIndex(node.variants, value) : -1);
  const variant = $derived(
    chosen >= 0
      ? describeField(node.variants[chosen]!, node.root, {
          pointer: node.pointer,
          key: node.key,
          required: node.required,
        })
      : undefined,
  );
  function choose(index: number) {
    if (index < 0) {
      value = undefined;
      return;
    }
    const picked = describeField(node.variants[index]!, node.root, {
      pointer: node.pointer,
      key: node.key,
      required: node.required,
    });
    value = { ...(emptyValue(picked) as object), ...variantSeed(node.variants[index]!) };
  }

  const text = (event: Event & { currentTarget: HTMLInputElement | HTMLTextAreaElement }) =>
    event.currentTarget.value;
  const numeric = (event: Event & { currentTarget: HTMLInputElement }) =>
    event.currentTarget.value === '' ? undefined : event.currentTarget.valueAsNumber;
  const optionValue = (node: FieldNode, raw: string) =>
    node.options.find((option) => String(option.value) === raw)?.value;
</script>

{#if node.fixed}
  <!-- A pinned value of a variant is part of the data, never of the form. -->
{:else if Widget}
  <Widget {node} {value} errors={own} {disabled} onchange={(next: unknown) => (value = next)} />
{:else if node.kind === 'string' || node.kind === 'password'}
  <FieldShell
    label={node.label}
    hint={node.kind === 'password'
      ? [node.description, t('kit.form.secretHint')].filter(Boolean).join(' ')
      : node.description}
    errors={own}
    {required}
    requiredText={t('kit.form.required')}
  >
    {#snippet children({ id, describedBy, invalid })}
      <input
        {id}
        class="input input-bordered w-full"
        class:input-error={invalid}
        type={node.kind === 'password'
          ? 'password'
          : node.format === 'email'
            ? 'email'
            : node.format === 'uri'
              ? 'url'
              : 'text'}
        autocomplete={node.kind === 'password' ? 'new-password' : 'off'}
        name={node.pointer}
        value={node.kind === 'password' ? '' : ((value as string | null | undefined) ?? '')}
        minlength={node.minLength}
        maxlength={node.maxLength}
        aria-describedby={describedBy}
        aria-invalid={invalid ? 'true' : undefined}
        {disabled}
        oninput={(event) => (value = text(event))}
      />
    {/snippet}
  </FieldShell>
{:else if node.kind === 'text'}
  <FieldShell
    label={node.label}
    hint={node.description}
    errors={own}
    {required}
    requiredText={t('kit.form.required')}
  >
    {#snippet children({ id, describedBy, invalid })}
      <textarea
        {id}
        class="textarea textarea-bordered min-h-32 w-full"
        class:textarea-error={invalid}
        name={node.pointer}
        maxlength={node.maxLength}
        aria-describedby={describedBy}
        aria-invalid={invalid ? 'true' : undefined}
        {disabled}
        value={(value as string | null | undefined) ?? ''}
        oninput={(event) => (value = text(event))}></textarea>
    {/snippet}
  </FieldShell>
{:else if node.kind === 'number' || node.kind === 'integer'}
  <FieldShell
    label={node.label}
    hint={node.description}
    errors={own}
    {required}
    requiredText={t('kit.form.required')}
  >
    {#snippet children({ id, describedBy, invalid })}
      <input
        {id}
        class="input input-bordered w-full"
        class:input-error={invalid}
        type="number"
        inputmode={node.kind === 'integer' ? 'numeric' : 'decimal'}
        name={node.pointer}
        min={node.minimum}
        max={node.maximum}
        step={stepOf(node)}
        aria-describedby={describedBy}
        aria-invalid={invalid ? 'true' : undefined}
        {disabled}
        value={typeof value === 'number' ? value : ''}
        oninput={(event) => (value = numeric(event))}
      />
    {/snippet}
  </FieldShell>
{:else if node.kind === 'boolean'}
  <div class="flex flex-col gap-1">
    <label class="flex items-center gap-3">
      <input
        type="checkbox"
        class="toggle"
        name={node.pointer}
        checked={value === true}
        {disabled}
        aria-describedby={node.description ? `${idBase}-hint` : undefined}
        onchange={(event) => (value = event.currentTarget.checked)}
      />
      <span class="text-sm font-medium">{node.label}</span>
    </label>
    {#if node.description}<p id="{idBase}-hint" class="text-sm opacity-70">
        {node.description}
      </p>{/if}
    {#if own.length > 0}<p class="text-error text-sm">{own.join(' ')}</p>{/if}
  </div>
{:else if node.kind === 'enum'}
  <FieldShell
    label={node.label}
    hint={node.description}
    errors={own}
    {required}
    requiredText={t('kit.form.required')}
  >
    {#snippet children({ id, describedBy, invalid })}
      <select
        {id}
        class="select select-bordered w-full"
        class:select-error={invalid}
        name={node.pointer}
        aria-describedby={describedBy}
        aria-invalid={invalid ? 'true' : undefined}
        {disabled}
        value={typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : ''}
        onchange={(event) => (value = optionValue(node, event.currentTarget.value))}
      >
        {#if value === undefined}<option value="">{t('kit.form.choose')}</option>{/if}
        {#each node.options as option (String(option.value))}
          <option value={String(option.value)}>{option.label}</option>
        {/each}
      </select>
    {/snippet}
  </FieldShell>
{:else if node.kind === 'object'}
  {#snippet fields()}
    {#each groupChildren(node.children) as group (group.name ?? '')}
      {#if group.name !== undefined}
        <fieldset class="border-base-300 flex flex-col gap-4 rounded-box border p-4">
          <legend class="px-1 font-semibold">{group.name}</legend>
          {#each group.fields as child (child.key)}
            <SchemaField
              node={child}
              bind:value={record[child.key]}
              {errors}
              {widgets}
              {disabled}
            />
          {/each}
        </fieldset>
      {:else}
        {#each group.fields as child (child.key)}
          {#if child.kind === 'object'}
            <fieldset
              class="border-base-300 flex flex-col gap-4 rounded-box border p-4"
              data-invalid={hasErrorsUnder(errors, child.pointer) ? 'true' : undefined}
            >
              <legend class="px-1 font-semibold">{child.label}</legend>
              {#if child.description}<p class="text-sm opacity-70">{child.description}</p>{/if}
              <SchemaField
                node={child}
                bind:value={record[child.key]}
                {errors}
                {widgets}
                {disabled}
                root
              />
            </fieldset>
          {:else}
            <SchemaField
              node={child}
              bind:value={record[child.key]}
              {errors}
              {widgets}
              {disabled}
            />
          {/if}
        {/each}
      {/if}
    {/each}
  {/snippet}
  {#if value !== null && typeof value === 'object'}
    <div class="flex flex-col gap-4">
      {#if !root && own.length > 0}<p class="text-error text-sm">{own.join(' ')}</p>{/if}
      {@render fields()}
    </div>
  {/if}
{:else if node.kind === 'scalarArray'}
  <fieldset
    class="flex flex-col gap-2"
    aria-describedby={own.length > 0 ? `${idBase}-error` : undefined}
  >
    <legend class="text-sm font-medium">{node.label}</legend>
    {#if node.description}<p class="text-sm opacity-70">{node.description}</p>{/if}
    {#each [...list.keys()] as index (index)}
      <div class="flex items-end gap-2" id="{idBase}-item-{index}">
        <div class="flex-1">
          <FieldShell
            label={t('kit.form.itemOf', { label: node.label, index: index + 1 })}
            errors={messagesFor(errors, childPointer(node.pointer, index))}
          >
            {#snippet children({ id, describedBy, invalid })}
              <input
                {id}
                class="input input-bordered w-full"
                class:input-error={invalid}
                type={node.items?.type === 'number' || node.items?.type === 'integer'
                  ? 'number'
                  : 'text'}
                aria-describedby={describedBy}
                aria-invalid={invalid ? 'true' : undefined}
                {disabled}
                value={String((list[index] as string | number | undefined) ?? '')}
                oninput={(event) => {
                  const next = [...list];
                  next[index] =
                    node.items?.type === 'number' || node.items?.type === 'integer'
                      ? numeric(event)
                      : text(event);
                  value = next;
                }}
              />
            {/snippet}
          </FieldShell>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          {disabled}
          aria-label={t('kit.form.removeItem', { label: node.label, index: index + 1 })}
          onclick={() => askToRemove(index)}
        >
          {t('kit.form.remove')}
        </button>
      </div>
    {/each}
    {#if list.length === 0}<p class="text-sm opacity-70">{t('kit.form.none')}</p>{/if}
    <div>
      <button
        id="{idBase}-add"
        type="button"
        class="btn btn-sm"
        disabled={disabled || !canAdd}
        onclick={add}
      >
        {t('kit.form.add')}
      </button>
    </div>
    {#if own.length > 0}<p id="{idBase}-error" class="text-error text-sm">{own.join(' ')}</p>{/if}
    <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
  </fieldset>
{:else if node.kind === 'objectArray'}
  <fieldset class="flex flex-col gap-3">
    <legend class="text-sm font-medium">{node.label}</legend>
    {#if node.description}<p class="text-sm opacity-70">{node.description}</p>{/if}
    {#each [...list.keys()] as index (index)}
      {@const entry = itemNode(index)}
      <div
        class="border-base-300 rounded-box flex flex-col gap-3 border p-4"
        id="{idBase}-item-{index}"
        role="group"
        aria-label={t('kit.form.itemOf', { label: node.label, index: index + 1 })}
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-medium">
            {t('kit.form.itemOf', { label: node.label, index: index + 1 })}
          </h3>
          <div class="flex gap-1">
            <button
              id="{idBase}-up-{index}"
              type="button"
              class="btn btn-ghost btn-xs"
              disabled={disabled || index === 0}
              aria-label={t('kit.form.moveUp', { label: node.label, index: index + 1 })}
              onclick={() => move(index, -1)}
            >
              <span aria-hidden="true">↑</span>
            </button>
            <button
              id="{idBase}-down-{index}"
              type="button"
              class="btn btn-ghost btn-xs"
              disabled={disabled || index === list.length - 1}
              aria-label={t('kit.form.moveDown', { label: node.label, index: index + 1 })}
              onclick={() => move(index, 1)}
            >
              <span aria-hidden="true">↓</span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              {disabled}
              aria-label={t('kit.form.removeItem', { label: node.label, index: index + 1 })}
              onclick={() => askToRemove(index)}
            >
              {t('kit.form.remove')}
            </button>
          </div>
        </div>
        <SchemaField node={entry} bind:value={list[index]} {errors} {widgets} {disabled} root />
      </div>
    {/each}
    {#if list.length === 0}<p class="text-sm opacity-70">{t('kit.form.none')}</p>{/if}
    <div>
      <button
        id="{idBase}-add"
        type="button"
        class="btn btn-sm"
        disabled={disabled || !canAdd}
        onclick={add}
      >
        {t('kit.form.add')}
      </button>
    </div>
    {#if own.length > 0}<p class="text-error text-sm">{own.join(' ')}</p>{/if}
    <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
  </fieldset>
{:else if node.kind === 'oneOf'}
  <div class="flex flex-col gap-3">
    <FieldShell
      label={node.label}
      hint={node.description}
      errors={own}
      {required}
      requiredText={t('kit.form.required')}
    >
      {#snippet children({ id, describedBy, invalid })}
        <select
          {id}
          class="select select-bordered w-full"
          aria-describedby={describedBy}
          aria-invalid={invalid ? 'true' : undefined}
          {disabled}
          value={String(chosen)}
          onchange={(event) => choose(Number(event.currentTarget.value))}
        >
          {#if chosen < 0}<option value="-1">{t('kit.form.choose')}</option>{/if}
          {#each node.variants as option, index (index)}
            <option value={String(index)}>
              {variantLabel(option, index, (n) => t('kit.form.option', { n }))}
            </option>
          {/each}
        </select>
      {/snippet}
    </FieldShell>
    {#if variant && value !== null && typeof value === 'object'}
      <SchemaField node={variant} bind:value {errors} {widgets} {disabled} root />
    {/if}
  </div>
{:else}
  <div class="flex flex-col gap-1">
    <span class="text-sm font-medium">{node.label}</span>
    <p class="text-sm opacity-70">{t('kit.form.opaque')}</p>
    <code class="bg-base-200 rounded p-2 text-xs break-all">{JSON.stringify(value) ?? ''}</code>
    {#if own.length > 0}<p class="text-error text-sm">{own.join(' ')}</p>{/if}
  </div>
{/if}

{#if node.kind === 'scalarArray' || node.kind === 'objectArray'}
  <ConfirmDialog
    open={removing !== undefined}
    title={t('kit.form.removeTitle')}
    message={t('kit.form.removeMessage', { label: node.label, index: (removing ?? 0) + 1 })}
    confirmLabel={t('kit.form.remove')}
    onconfirm={confirmRemove}
    oncancel={() => (removing = undefined)}
  />
{/if}
