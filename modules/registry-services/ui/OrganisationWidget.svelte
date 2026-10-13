<script lang="ts">
  // The widget `organisation`: the organisations the API listed for this caller and this role (the page's
  // loader asked: the caller's own memberships for the owning role, every organisation of the role's types for
  // an administrator and for the other roles). Never a list guessed from a role in the browser; the server
  // checks the choice again and answers 403 or 422. One organisation is a select, several are check boxes.
  import { FieldShell, getShell, type WidgetProps } from '@scorpion/ui-kit';
  import { getWizardContext } from './wizard-context.ts';

  let { node, value, onchange, errors, disabled }: WidgetProps = $props();
  const { t } = getShell();
  const wizard = getWizardContext();
  const id = $props.id();

  const field = $derived(wizard.field(node.pointer));
  const multiple = $derived(field?.config.multiple === true);
  const choices = $derived(field?.role ? wizard.organisations(field.role) : undefined);
  const options = $derived(choices?.options ?? []);
  const chosen = $derived(Array.isArray(value) ? (value as string[]) : []);
  const text = (option: { abbreviation: string; name: string }) =>
    `${option.name} (${option.abbreviation})`;

  function toggle(option: string, on: boolean) {
    const next = on ? [...chosen, option] : chosen.filter((entry) => entry !== option);
    onchange(options.map((entry) => entry.id).filter((candidate) => next.includes(candidate)));
  }
  const describedBy = $derived(
    [
      node.description ? `${id}-hint` : '',
      errors.length > 0 ? `${id}-error` : '',
      options.length === 0 || choices?.truncated ? `${id}-note` : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined,
  );
</script>

{#if multiple}
  <fieldset class="flex flex-col gap-1" aria-describedby={describedBy}>
    <legend class="text-sm font-medium">
      {node.label}{#if node.required}<span class="opacity-70">
          ({t('kit.form.required')})</span
        >{/if}
    </legend>
    {#each options as option (option.id)}
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          checked={chosen.includes(option.id)}
          {disabled}
          onchange={(event) => toggle(option.id, event.currentTarget.checked)}
        />
        <span>{text(option)}</span>
      </label>
    {/each}
    {#if options.length === 0}<p id="{id}-note" class="text-sm opacity-70">
        {t('services.organisations.none')}
      </p>{/if}
    {#if choices?.truncated}<p id="{id}-note" class="text-sm opacity-70">
        {t('services.organisations.more')}
      </p>{/if}
    {#if node.description}<p id="{id}-hint" class="text-sm opacity-70">{node.description}</p>{/if}
    {#if errors.length > 0}<p id="{id}-error" class="text-error text-sm">{errors.join(' ')}</p>{/if}
  </fieldset>
{:else}
  <FieldShell
    label={node.label}
    hint={node.description}
    {errors}
    required={node.required}
    requiredText={t('kit.form.required')}
  >
    {#snippet children({ id: controlId, describedBy: shellDescribedBy, invalid })}
      <select
        id={controlId}
        class="select select-bordered w-full"
        class:select-error={invalid}
        aria-describedby={[
          shellDescribedBy,
          options.length === 0 || choices?.truncated ? `${controlId}-note` : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined}
        aria-invalid={invalid ? 'true' : undefined}
        {disabled}
        onchange={(event) =>
          onchange(event.currentTarget.value === '' ? undefined : event.currentTarget.value)}
      >
        <option value="" selected={value === undefined || value === ''}
          >{t('services.choice.choose')}</option
        >
        {#each options as option (option.id)}
          <option value={option.id} selected={value === option.id}>{text(option)}</option>
        {/each}
      </select>
      {#if options.length === 0}
        <p id="{controlId}-note" class="text-sm opacity-70">{t('services.organisations.none')}</p>
      {:else if choices?.truncated}
        <p id="{controlId}-note" class="text-sm opacity-70">{t('services.organisations.more')}</p>
      {/if}
    {/snippet}
  </FieldShell>
{/if}
