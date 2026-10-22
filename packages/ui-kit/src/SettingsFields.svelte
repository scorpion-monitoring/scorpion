<script lang="ts">
  // The fields of the shared widget settings form, drawn from `fieldsOf(schema)`: the service picker, the range, the thematic category and
  // the widget's own toggles and choices. The values live in `draft`; the form decides when they are applied.
  import { onMount } from 'svelte';
  import { getShell } from './context.ts';
  import { getAnalyticsReads } from './read-store.ts';
  import ServiceChoice from './ServiceChoice.svelte';
  import { RANGE_KEYS, type SettingsField } from './widget-settings.ts';

  let {
    fields,
    draft = $bindable(),
    problems,
  }: {
    fields: readonly SettingsField[];
    draft: Record<string, unknown>;
    /** The names of the fields that break the widget's schema. */
    problems?: ReadonlySet<string>;
  } = $props();

  const { t } = getShell();
  const reads = getAnalyticsReads();
  const id = $props.id();

  // The categories are the one vocabulary read the dashboard and the defaults dialog share (the defaults route lists them).
  let categories = $state<{ key: string; label: string }[]>([]);
  let categoriesFailed = $state(false);
  onMount(() => {
    if (!fields.some((field) => field.kind === 'category')) return;
    reads.defaults().then(
      (own) => (categories = own.categories),
      () => (categoriesFailed = true),
    );
  });

  const rangeLabel = (range: string) => {
    const key = RANGE_KEYS[range];
    return key ? t(key) : range;
  };
  /** A toggle's label from the catalogue; a name the catalogue does not know is shown as it is. */
  const toggleLabel = (name: string) => {
    const key = `kit.widget.field.${name}`;
    const text = t(key);
    return text === key ? name : text;
  };
  const bad = (name: string) => problems?.has(name) ?? false;
</script>

<div class="flex flex-col gap-4">
  {#each fields as field (field.name)}
    {#if field.kind === 'service'}
      <ServiceChoice
        value={typeof draft[field.name] === 'string' ? (draft[field.name] as string) : null}
        onchange={(next) => {
          draft[field.name] = next;
        }}
        invalid={bad(field.name)}
      />
    {:else if field.kind === 'range'}
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="{id}-{field.name}">{t('kit.widget.range')}</label>
        <select
          id="{id}-{field.name}"
          class="select select-bordered w-full"
          aria-invalid={bad(field.name) ? 'true' : undefined}
          bind:value={draft[field.name]}
        >
          {#each field.options as option (option)}
            <option value={option}>{rangeLabel(option)}</option>
          {/each}
        </select>
      </div>
    {:else if field.kind === 'category'}
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="{id}-{field.name}">{t('kit.widget.category')}</label
        >
        <select
          id="{id}-{field.name}"
          class="select select-bordered w-full"
          aria-invalid={bad(field.name) ? 'true' : undefined}
          bind:value={draft[field.name]}
        >
          <option value="all">{t('kit.widget.category.all')}</option>
          {#each categories as category (category.key)}
            <option value={category.key}>{category.label}</option>
          {/each}
        </select>
        {#if categoriesFailed}
          <p class="text-error text-sm" role="alert">{t('kit.widget.category.failed')}</p>
        {/if}
      </div>
    {:else if field.kind === 'boolean'}
      <label class="label cursor-pointer justify-start gap-3">
        <input
          type="checkbox"
          class="checkbox"
          checked={draft[field.name] === true}
          onchange={(event) => (draft[field.name] = event.currentTarget.checked)}
        />
        <span>{toggleLabel(field.name)}</span>
      </label>
    {:else}
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="{id}-{field.name}">{toggleLabel(field.name)}</label>
        <select
          id="{id}-{field.name}"
          class="select select-bordered w-full"
          bind:value={draft[field.name]}
        >
          {#each field.options as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>
    {/if}
  {/each}
</div>
